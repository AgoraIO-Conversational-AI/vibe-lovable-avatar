import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Phone, PhoneOff, Settings, SendHorizontal, AlertTriangle, Video } from "lucide-react";
import { useAgoraVideoClient } from "@/hooks/useAgoraVideoClient";
import { useAudioVisualization } from "@/hooks/useAudioVisualization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { AgoraLogo } from "./AgoraLogo";
import { ThemeToggle } from "./ThemeToggle";

interface EnvStatus {
  configured: Record<string, boolean>;
  ready: boolean;
  missing: string[];
}

export function VideoAvatarClient() {
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [greeting, setGreeting] = useState("");
  const [connectionTime, setConnectionTime] = useState(0);
  const [channelName, setChannelName] = useState("");
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const desktopVideoRef = useRef<HTMLDivElement>(null);
  const mobileVideoRef = useRef<HTMLDivElement>(null);

  const {
    isConnected,
    isMuted,
    isAgentSpeaking,
    agentState,
    messages,
    localAudioTrack,
    remoteVideoTrack,
    joinChannel,
    leaveChannel,
    toggleMute,
    setMessages,
    setTranscriptCallback,
    sendTextMessage,
  } = useAgoraVideoClient();

  const frequencyData = useAudioVisualization(
    localAudioTrack,
    isConnected && !isMuted
  );

  // Play remote video track into the visible container (desktop or mobile)
  useEffect(() => {
    if (!remoteVideoTrack) return;

    let stopped = false;

    const tryPlay = () => {
      const container = desktopVideoRef.current || mobileVideoRef.current;
      if (container && !stopped) {
        remoteVideoTrack.play(container);
        return true;
      }
      return false;
    };

    if (!tryPlay()) {
      const t1 = setTimeout(() => { if (!stopped && !tryPlay()) {
        const t2 = setTimeout(() => { if (!stopped) tryPlay(); }, 500);
        return () => clearTimeout(t2);
      }}, 100);
      return () => { stopped = true; clearTimeout(t1); remoteVideoTrack.stop(); };
    }

    return () => {
      stopped = true;
      remoteVideoTrack.stop();
    };
  }, [remoteVideoTrack, isConnected]);

  // Check env on load
  useEffect(() => {
    const checkEnv = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("check-env");
        if (error) throw error;
        setEnvStatus(data as EnvStatus);
      } catch (err) {
        console.error("Failed to check env:", err);
        setEnvStatus({ configured: {}, ready: false, missing: ["Unable to reach server"] });
      } finally {
        setEnvLoading(false);
      }
    };
    checkEnv();
  }, []);

  // Connection timer
  useEffect(() => {
    if (isConnected) {
      setConnectionTime(0);
      timerRef.current = setInterval(() => {
        setConnectionTime((t) => t + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isConnected]);

  // Auto-scroll
  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Transcript handler
  const handleTranscript = useCallback(
    (msg: Record<string, unknown>) => {
      const objectType = msg.object as string;
      const text = msg.text as string;
      const turnId = msg.turn_id as number;
      const isFinal = objectType === "assistant.transcription"
        ? (msg.turn_status as number) === 1
        : (msg.final as boolean);

      const role: "user" | "assistant" = objectType.startsWith("user")
        ? "user"
        : "assistant";
      const msgId = `${role}-${turnId}`;

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msgId);
        const updated = {
          id: msgId,
          role,
          text,
          timestamp: Date.now(),
          isFinal: !!isFinal,
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [...prev, updated];
      });
    },
    [setMessages]
  );

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      const body: Record<string, string> = {};
      if (prompt.trim()) body.prompt = prompt.trim();
      if (greeting.trim()) body.greeting = greeting.trim();

      const { data, error } = await supabase.functions.invoke("start-video-agent", {
        body,
      });

      if (error) throw error;
      if (!data.success) throw new Error(JSON.stringify(data));

      setAgentId(data.agentId);
      setChannelName(data.channel);
      setTranscriptCallback(handleTranscript);

      await joinChannel({
        appId: data.appId,
        channel: data.channel,
        token: data.token || null,
        uid: Number(data.uid),
        agentUid: data.agentUid,
        agentVideoUid: data.agentVideoUid || "102",
        agentRtmUid: data.agentRtmUid,
      });
    } catch (error) {
      console.error("Failed to connect:", error);
      alert(
        `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setTranscriptCallback(null);
    await leaveChannel();
    if (agentId) {
      try {
        await supabase.functions.invoke("hangup-agent", {
          body: { agentId },
        });
      } catch (err) {
        console.error("Hangup error:", err);
      }
      setAgentId(null);
    }
  };

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !isConnected) return;
    const text = chatMessage.trim();
    setChatMessage("");
    await sendTextMessage(text);
  };

  // Loading state
  if (envLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Missing env vars
  if (envStatus && !envStatus.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full border-destructive/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <h2 className="text-lg font-semibold">Configuration Required</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              The following environment variables are missing and need to be set
              in your project&apos;s Environment Variables settings:
            </p>
            <ul className="space-y-1 mb-4">
              {envStatus.missing.map((v) => (
                <li key={v} className="text-sm font-mono text-destructive">
                  {v}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pre-connection
  if (!isConnected) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <AgoraLogo size={28} />
            <div>
              <h1 className="text-sm font-semibold leading-tight">Agora Convo AI Video Agent</h1>
              <p className="text-xs text-muted-foreground">React with Agora Web SDK</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-md space-y-6 flex flex-col items-center">
            {/* Avatar icon */}
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="h-24 w-24 rounded-full bg-primary/20 flex items-center justify-center">
                  <div className="h-16 w-16 rounded-full bg-primary/40 flex items-center justify-center">
                    <Video className="h-8 w-8 text-primary" />
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Talk to an AI assistant with a video avatar
              </p>
            </div>

            {/* Connect button */}
            <Button
              onClick={handleConnect}
              disabled={isLoading}
              className="w-64 mx-auto h-11 rounded-lg text-sm gap-2"
              size="lg"
            >
              <Phone className="h-4 w-4" />
              {isLoading ? "Connecting..." : "Start Call"}
            </Button>

            {showSettings && (
              <Card className="border w-full">
                <CardContent className="pt-4 space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">
                      System Prompt
                    </label>
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="You are a friendly voice assistant..."
                      className="resize-none"
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">
                      Greeting Message
                    </label>
                    <Input
                      value={greeting}
                      onChange={(e) => setGreeting(e.target.value)}
                      placeholder="Hi there! How can I help you today?"
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Connected state — Desktop
  const desktopView = (
    <div className="hidden md:flex flex-1 min-h-0 overflow-hidden flex-row">
      {/* Left column - Avatar video (60%) */}
      <div className="flex flex-col w-[60%] border-r">
        {/* Video container */}
        <div className="flex-1 relative bg-black">
          <div
            ref={desktopVideoRef}
            className="absolute inset-0"
          />
          {!remoteVideoTrack && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <div className="h-20 w-20 rounded-full bg-primary/20 animate-pulse flex items-center justify-center">
                <Video className="h-10 w-10 text-primary/60" />
              </div>
              <span className="text-sm text-muted-foreground">
                Connecting avatar...
              </span>
            </div>
          )}
        </div>

        {/* Mic control + waveform */}
        <div className="p-4 space-y-3 flex-shrink-0">
          <div className="flex justify-center">
            <button
              onClick={toggleMute}
              className={cn(
                "w-11 h-11 rounded-lg flex items-center justify-center transition-colors",
                isMuted
                  ? "bg-muted text-destructive"
                  : "bg-primary text-primary-foreground"
              )}
            >
              {isMuted ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Audio waveform — always rendered to prevent layout shift */}
          <div className="flex items-end justify-center gap-0.5 h-8">
            {Array.from({ length: 24 }).map((_, i) => {
              const val = !isMuted ? (frequencyData[i] ?? 0) : 0;
              return (
                <div
                  key={i}
                  className="w-1 bg-primary/60 rounded-full transition-all duration-75"
                  style={{ height: `${Math.max(2, (val / 255) * 32)}px` }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Right column - Chat (40%) */}
      <div className="flex flex-col w-[40%] min-h-0 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground mt-8">
              Start talking or type a message...
            </p>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col gap-1",
                msg.role === "user" ? "items-end" : "items-start"
              )}
            >
              <span className="text-xs text-muted-foreground px-1">
                {msg.role === "user" ? "You" : "Agent"}
              </span>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                  msg.role === "user"
                    ? "bg-foreground text-background rounded-br-md"
                    : "bg-secondary text-secondary-foreground rounded-bl-md"
                )}
              >
                {msg.text}
              </div>
            </div>
          ))}
          <div ref={conversationEndRef} />
        </div>

        {/* Text input */}
        <div className="border-t p-3 flex gap-2 flex-shrink-0">
          <Input
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 h-10"
          />
          <button
            onClick={handleSendMessage}
            disabled={!chatMessage.trim()}
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors disabled:cursor-not-allowed",
              chatMessage.trim()
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground"
            )}
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  // Connected state — Mobile
  const mobileView = (
    <div className="flex md:hidden flex-1 flex-col min-h-0 overflow-hidden">
      <Tabs defaultValue="avatar" className="flex flex-col flex-1 min-h-0">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="avatar" className="flex-1">Avatar</TabsTrigger>
          <TabsTrigger value="chat" className="flex-1">Chat</TabsTrigger>
        </TabsList>

        <TabsContent value="avatar" className="flex-1 flex flex-col min-h-0 m-0">
          {/* Video */}
          <div className="flex-1 relative bg-black">
            <div
              ref={mobileVideoRef}
              className="absolute inset-0"
            />
            {!remoteVideoTrack && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/20 animate-pulse flex items-center justify-center">
                  <Video className="h-8 w-8 text-primary/60" />
                </div>
                <span className="text-sm text-muted-foreground">
                  Connecting avatar...
                </span>
              </div>
            )}
          </div>

          {/* Status */}
          <div className="text-center text-sm text-muted-foreground capitalize py-2">
            {agentState === "talking"
              ? "Agent Speaking"
              : agentState === "listening"
                ? "Listening..."
                : agentState}
          </div>
        </TabsContent>

        <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 m-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-center text-sm text-muted-foreground mt-8">
                Start talking or type a message...
              </p>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col gap-1",
                  msg.role === "user" ? "items-end" : "items-start"
                )}
              >
                <span className="text-xs text-muted-foreground px-1">
                  {msg.role === "user" ? "You" : "Agent"}
                </span>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                    msg.role === "user"
                      ? "bg-foreground text-background rounded-br-md"
                      : "bg-secondary text-secondary-foreground rounded-bl-md"
                  )}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={conversationEndRef} />
          </div>

          {/* Text input */}
          <div className="border-t p-3 flex gap-2 flex-shrink-0">
            <Input
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Type a message..."
              className="flex-1 h-10"
            />
            <button
              onClick={handleSendMessage}
              disabled={!chatMessage.trim()}
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors disabled:cursor-not-allowed",
                chatMessage.trim()
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Mobile bottom controls */}
      <div className="flex justify-center gap-3 p-3 border-t">
        <button
          onClick={toggleMute}
          className={cn(
            "w-11 h-11 rounded-lg flex items-center justify-center transition-colors",
            isMuted
              ? "bg-muted text-destructive"
              : "bg-primary text-primary-foreground"
          )}
        >
          {isMuted ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={handleDisconnect}
          className="h-11 px-6 rounded-lg bg-destructive text-white flex items-center justify-center gap-2 hover:bg-destructive/90 transition-colors text-sm font-medium"
        >
          <PhoneOff className="h-4 w-4" />
          End Call
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <AgoraLogo size={24} />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold leading-tight">Agora Convo AI Video Agent</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
              <span className="font-mono">{formatTime(connectionTime)}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={handleDisconnect}
            className="hidden md:flex rounded-lg bg-destructive px-5 py-2.5 text-white hover:bg-destructive/90 transition-colors items-center gap-2 text-sm font-medium"
          >
            <PhoneOff className="h-4 w-4" />
            End Call
          </button>
        </div>
      </header>

      {desktopView}
      {mobileView}
    </div>
  );
}

export default VideoAvatarClient;

export interface UriComponents {
  scheme: string;
  authority: string;
  path: string;
}

export function createLocalChatSessionUri(
  sessionId: string
): UriComponents {
  const encodedSessionId = Buffer.from(sessionId, "utf8").toString(
    "base64url"
  );
  return {
    scheme: "vscode-chat-session",
    authority: "local",
    path: `/${encodedSessionId}`
  };
}

let ioInstance = null;

export function setIo(io) {
  ioInstance = io;
}

export function getIo() {
  return ioInstance;
}

export function emitToUser(userId, event, payload) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit(event, payload);
}

export function emitToRoom(room, event, payload) {
  if (!ioInstance) return;
  ioInstance.to(room).emit(event, payload);
}

export function emitToAll(event, payload) {
  if (!ioInstance) return;
  ioInstance.emit(event, payload);
}

export function joinUserToRoom(userId, room) {
  if (!ioInstance) return;
  ioInstance.in(`user:${userId}`).socketsJoin(room);
}

export function removeUserFromRoom(userId, room) {
  if (!ioInstance) return;
  ioInstance.in(`user:${userId}`).socketsLeave(room);
}

export function disconnectUserSockets(userId) {
  if (!ioInstance) return;
  ioInstance.in(`user:${userId}`).disconnectSockets(true);
}

/**
 * Disconnect sockets belonging to a user. Either disconnect one specific
 * session, every session except one, or all sessions when neither is given.
 */
export async function disconnectSessions(userId, { sessionId = null, keepSessionId = null } = {}) {
  if (!ioInstance) return 0;
  const sockets = await ioInstance.in(`user:${userId}`).fetchSockets();
  let count = 0;
  for (const socket of sockets) {
    const socketSession = socket.data?.sessionId;
    if (sessionId && socketSession !== sessionId) continue;
    if (keepSessionId && socketSession === keepSessionId) continue;
    socket.disconnect(true);
    count += 1;
  }
  return count;
}

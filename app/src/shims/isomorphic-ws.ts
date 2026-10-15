// SPDX-License-Identifier: Apache-2.0
// The indexer client imports { WebSocket } from isomorphic-ws, whose browser entry only has a
// default export. In the browser the native WebSocket is the right implementation anyway.
const NativeWebSocket = globalThis.WebSocket;
export { NativeWebSocket as WebSocket };
export default NativeWebSocket;

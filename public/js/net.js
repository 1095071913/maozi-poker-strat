/** Socket.IO 封装：带 ack 的 emit */
(() => {
  const socket = io({ reconnection: true, reconnectionDelay: 800 });

  window.Net = {
    socket,
    /** emit 并等待服务端 ack，返回 Promise */
    emitAck(event, data) {
      return new Promise((resolve) => {
        socket.emit(event, data, (res) => resolve(res || {}));
      });
    },
  };
})();

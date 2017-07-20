'use strict'

const dgram = require('dgram')
const debug = require('debug')('rtail:server')

require('debug').enable('socket.io:*')

const SocketIO = require('socket.io')

exports.register = (server, options, next) => {
  const io = SocketIO(server.listener, { path: (server.realm.modifiers.route.prefix || '/rtail') + '/socket.io' })
  io.set('transports', ['websocket']) // forces client to connect as websockets. If client tries xhr polling, it won't connect.

  /*!
   * UDP sockets setup
   */
  const udpHost = server.info.host
  const udpPort = server.info.port
  var streams = {}
  var udpSocket = dgram.createSocket('udp4')

  udpSocket.on('message', function (data, remote) {
    // try to decode JSON
    try {
      data = JSON.parse(data)
    } catch (err) {
      return debug('invalid data sent')
    }

    if (!streams[data.id]) {
      streams[data.id] = []
      io.sockets.emit('streams', Object.keys(streams))
    }

    var message = {
      timestamp: data.timestamp,
      streamid: data.id,
      host: remote.address,
      port: remote.port,
      content: data.content,
      type: typeof data.content
    }

    // limit backlog to 100 lines
    streams[data.id].length >= 100 && streams[data.id].shift()
    streams[data.id].push(message)

    debug(JSON.stringify(message))
    io.sockets.to(data.id).emit('line', message)
  })

  /*
      handle socket.io connections
  */
  io.on('connection', socket => {
    console.log('New connection!')
    socket.emit('streams', Object.keys(streams))
    socket.on('select stream', stream => {
      socket.leave(socket.rooms[0])
      if (!stream) return
      socket.join(stream)
      socket.emit('backlog', streams[stream])
    })
  })

  udpSocket.bind(udpPort, udpHost)
  debug('UDP server listening: %s:%s', udpHost, udpPort)

  /*
      serve our static files
  */
  server.register(require('inert'), (err) => {
    if (err) {
      throw err
    }

    server.route({
      path: '/{static*}',
      method: 'GET',
      handler: {
        directory: {
          path: require('path').join(__dirname, 'dist'),
          listing: true
        }
      }
    })
  })

  next()
}

exports.register.attributes = {
  pkg: require('./package.json')
}

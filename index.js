var http = require('http');
var WebSocketServer = require('ws').Server;

function copy(a) {
  var b = {};
  for(var m in a){
    b[m] = a[m];
  }
  return b;
}

function ChatServer(options){

    if(!options) return console.log(`node-chat-server: you must provide an options object.`)
    if(!options.create) return console.log(`node-chat-server: you must provide a 'create' method in options for creating a new chat message.`)
    if(!options.authorize) return console.log(`node-chat-server: you must provide an 'authorize' method in options for authorizing connecting sockets.`)
    if(!options.getMessages) return console.log(`node-chat-server: you must provide a 'getMessages' method in options for retrieving a set of chat messages.`)
    if(!options.read) return console.log(`node-chat-server: you must provide a 'read' method in options to mark a chat message as being read.`)

    var chatServer = this;
    var port = options.port || 8080;
    var httpServer = http.createServer();
    var server = new WebSocketServer({ server: httpServer });

    chatServer.sockets = [];

    function sendMessage(message, userId, done) {
      userId = userId.toString();
      chatServer.sockets.map(function (socket) {
        if(socket.user && ((socket.user.id || socket.user._id).toString() === userId)){
          socket.action('chatMessage', message);
        }
      });
    }

    var actions = {
      authorize(socket, data, done){
        options.authorize(data, function (err, user) {

          if(err){
            return console.log(`node-chat-server: authorization error ${ err.message || err.toString() }`);
          }
          if(!user){
            return done('authorizationFailed');
          }


          socket.user = user;
          chatServer.sockets.push(socket);
          if(options.log){
            console.log(`node-chat-server: authorizing ${user.name || user.id || user._id}. ${chatServer.sockets.length} connected sockets.`)
          }
          done(null, user);

        });
      },
      create(socket, data, done){
        var message = copy(data);
        if(!message.to) {
          return done(`node-chat-server: a chat message must contain a 'to' property which should be a valid id of a user or a group.`);
        }
        var user = socket.user;
        message.createdAt = new Date();
        message.from = (user.id || user._id).toString();
        if(options.log){
          console.log(`node-chat-server: creating chat message for ${user.name || user.id || user._id}`)
        }
        options.create(message, function (err, msg) {

          if(err){ return done(err); }

          if(msg.isGroup){
            options.getGroupUserIds({ groupId: msg.to }, function (err, userIds) {
              if(err){ return done(err); }
              userIds.map(function (userId) {
                sendMessage(msg, userId);
              });
              done(null, msg);
            });
          }
          else{
            sendMessage(msg, msg.to);
            sendMessage(msg, msg.from);
            done(null, msg);
          }
        });
      },
      getMessages(socket, data, done){
        var query = copy(data);
        query.ids = [(socket.user.id || socket.user._id).toString(), query.with];
        if(!query.skip){
          query.skip = 0;
        }
        if(!query.limit){
          query.limit = 10;
        }
        options.getMessages(query, done);
      },
      read(socket, data, done){
        options.read(data.id, done);
      }
    };

    server.on('connection', function (socket) {           // fired for every incoming socket connection.

      if(options.log){
        console.log(`node-chat-server: connecting socket`)
      }

      socket.action = function(type, data){  // run an action on the client.
          socket.send(JSON.stringify({type: type, data: data}));
      };

      socket.on('message', function(msg){
          try {
              var json = JSON.parse(msg);
              if(!json.type){ return console.error(`json does not have a 'type'`); }

              // if unauthorized sockets try to do anything other then
              // requesting authorization - disconnect them immediately.
              if((json.type !== 'authorize') && (!socket.user || (!socket.user.id && !socket.user._id))){
                if(options.log){
                  console.log(`node-chat-server: disconnecting unauthorized socket`)
                }
                return socket.close();
              }

              console.log('node-chat-server: got - ', json);

              if(actions[json.type]){ // perform a chat server action.
                actions[json.type](socket, json.data, function(err, res){
                    socket.send(JSON.stringify({id: json.id, error: err, data: res}));
                }, socket);
              }
              else if(options.actions && options.actions[json.type]){ // perform a user defined action.
                return options.actions[json.type](socket, json.data, function(err, res){
                    socket.send(JSON.stringify({id: json.id, error: err, data: res}));
                }, socket);
              }
              else{
                return console.error(`cannot find action ${json.type}`);
              }

          } catch (e) {
              return console.error(e);
          }
      });

      socket.on('close', function () {
          var index = chatServer.sockets.indexOf(socket);
          if(options.log){
            console.log(`node-chat-server: socket closing`)
          }
          if(index > -1){
            chatServer.sockets.splice(index, 1);
            if(options.log){
              console.log(`node-chat-server: splicing authorized socket. ${chatServer.sockets.length} connected sockets`)
            }
          }
      });
    });

    httpServer.listen(port, function(){
        console.log(`➜  chat server at port ${port}`);
    });

}

module.exports = ChatServer;

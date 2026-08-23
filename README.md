<p align="center"><a href="https://nodejs.org" target="_blank"><img src="https://nodejs.org/static/images/logo.svg" width="120" alt="Node.js Logo"></a></p>

## About Node.js

Node.js is an open-source and cross-platform JavaScript runtime environment. It is a popular tool for almost any kind of project!

Node.js runs the V8 JavaScript engine, the core of Google Chrome, outside of the browser. This allows Node.js to be very performant.

A Node.js app runs in a single process, without creating a new thread for every request. Node.js provides a set of asynchronous I/O primitives in its standard library that prevent JavaScript code from blocking. In addition, libraries in Node.js are generally written using non-blocking paradigms. Accordingly, blocking behavior is the exception rather than the norm in Node.js.

When Node.js performs an I/O operation, like reading from the network, accessing a database or the filesystem, instead of blocking the thread and wasting CPU cycles waiting, Node.js will resume the operations when the response comes back.

This allows Node.js to handle thousands of concurrent connections with a single server without introducing the burden of managing thread concurrency, which could be a significant source of bugs.

## An Example Node.js Application

The most common example Hello World of Node.js is a web server:

```javascript
const { createServer } = require('node:http');

const hostname = '127.0.0.1';
const port = 3000;

const server = createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Hello World');
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
```

To run this snippet, save it as a `server.js` file and run `node server.js` in your terminal.

This code first includes the Node.js [`http` module](https://nodejs.org/api/http.html). Node.js has a fantastic [standard library](https://nodejs.org/api/), including first-class support for networking.

## Documentation

Documentation for Node.js can be found on the [Node.js website](https://nodejs.org/learn/getting-started/introduction-to-nodejs).

If you haven't already done so, [download](https://nodejs.org/en/download) Node.js.

## License

The Node.js runtime is open-sourced software licensed under the [MIT license](https://github.com/nodejs/node/blob/main/LICENSE).

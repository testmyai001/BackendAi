const http = require('http');

const TALLY_PORT = 9000;
const PROXY_PORT = 3001;
const TALLY_HOST = '127.0.0.1'; // IPv4

console.log(`---------------------------------------------------`);
console.log(`   AutoTally AI - Robust Proxy (Keep-Alive)`);
console.log(`---------------------------------------------------`);

// Create an Agent with Keep-Alive to maintain persistent connections to Tally
// This reduces the overhead of opening new TCP connections for every request
const tallyAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,
  keepAliveMsecs: 1000,
  timeout: 10000 // 10s socket timeout
});

const server = http.createServer((clientReq, clientRes) => {
  // Handle client errors to prevent crash
  clientReq.on('error', (err) => {
    console.error(`[ERROR] Client Request Error:`, err.message);
  });

  // 1. Log Request
  // console.log(`[${new Date().toLocaleTimeString()}] INCOMING: ${clientReq.method} ${clientReq.url}`);

  // 2. Handle CORS (Always allow)
  clientRes.setHeader('Access-Control-Allow-Origin', '*');
  clientRes.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  clientRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning');
  // Allow credentials if needed by some clients
  clientRes.setHeader('Access-Control-Allow-Credentials', 'true');

  // 3. Handle Preflight
  if (clientReq.method === 'OPTIONS') {
    clientRes.writeHead(204);
    clientRes.end();
    return;
  }

  // 4. Health Check Endpoint
  if (clientReq.url === '/health') {
    clientRes.writeHead(200, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ status: 'online', proxy: true }));
    return;
  }

  // 5. Sanitize Headers
  const cleanHeaders = {};
  if (clientReq.headers['content-type']) cleanHeaders['content-type'] = clientReq.headers['content-type'];
  if (clientReq.headers['content-length']) cleanHeaders['content-length'] = clientReq.headers['content-length'];
  
  // Force Host to look local
  cleanHeaders['host'] = `${TALLY_HOST}:${TALLY_PORT}`;
  cleanHeaders['connection'] = 'keep-alive'; // Use keep-alive

  const options = {
    hostname: TALLY_HOST,
    port: TALLY_PORT,
    path: '/', 
    method: clientReq.method,
    headers: cleanHeaders,
    family: 4, // Force IPv4
    agent: tallyAgent, // Use our persistent agent
    timeout: 15000 // 15s request timeout
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Forward status and headers from Tally
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });
  });

  proxyReq.on('error', (e) => {
    console.error(`[ERROR] Tally Unreachable: ${e.code}`);
    if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({ 
            error: true, 
            message: `Proxy is reachable, but Tally is NOT responding on port ${TALLY_PORT}. Error: ${e.code}` 
        }));
    }
  });

  proxyReq.on('timeout', () => {
      console.error('[ERROR] Tally Request Timed Out');
      proxyReq.destroy();
      if (!clientRes.headersSent) {
          clientRes.writeHead(504, { 'Content-Type': 'application/json' });
          clientRes.end(JSON.stringify({ error: true, message: "Tally Timed Out (Gateway Timeout)" }));
      }
  });

  // Pipe body from client to Tally
  clientReq.pipe(proxyReq, { end: true });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[FATAL] Port ${PROXY_PORT} is already in use! Please stop other proxy instances.`);
  } else {
    console.error(`[FATAL] Server error:`, e);
  }
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[OK] Proxy listening on port ${PROXY_PORT}`);
  console.log(`[INFO] Forwarding cleanly to http://${TALLY_HOST}:${TALLY_PORT}`);
});
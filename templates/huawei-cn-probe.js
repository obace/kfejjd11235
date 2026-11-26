/**
 * 华为云 FunctionGraph（华东-上海一 等大陆区域）单向被墙探测函数
 * 运行环境：Node.js 18.x / 20.x（零第三方依赖）
 * 环境变量：
 *   PANEL_URL       - 面板地址，例如 https://cd.sd
 *   OPS_API_KEY     - 面板 .env 中的 OPS_API_KEY
 *   PANEL_ORIGIN_IP - 可选，面板源站 IP（用于直连源站 HTTPS 绕过 Cloudflare 国内波动）
 *   PROBE_REGION    - 可选，探针标识（默认 cn-shanghai）
 */
const https = require('https');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const crypto = require('crypto');

function requestJsonOnce(urlStr, method = 'GET', token = '', body = null, originIp = '') {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: originIp || u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      timeout: 10000,
      headers: {
        'Host': u.host,
        'Authorization': `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    if (u.protocol === 'https:' && originIp) {
      opts.servername = u.hostname; // 保持 SNI 与证书域名一致
    }
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('HTTP timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function requestJson(urlStr, method = 'GET', token = '', body = null, originIp = '') {
  try {
    return await requestJsonOnce(urlStr, method, token, body, originIp);
  } catch (err) {
    return await requestJsonOnce(urlStr, method, token, body, originIp);
  }
}

function tcpProbe(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ reachable: ok, latencyMs: ok ? Date.now() - start : null, method: 'tcp' });
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
    sock.connect(port, host);
  });
}

// 发送 QUIC GREASE Version Negotiation 探测包验证 Hy2 UDP 端口可达性
function quicUdpProbeOnce(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const isV6 = net.isIPv6(host);
    const sock = dgram.createSocket(isV6 ? 'udp6' : 'udp4');
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { sock.close(); } catch {}
      resolve({ reachable: ok, latencyMs: ok ? Date.now() - start : null, method: 'quic-udp' });
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.on('message', () => { clearTimeout(timer); finish(true); });
    sock.on('error', () => { clearTimeout(timer); finish(false); });

    // 构造 1200 字节 QUIC Initial 包（使用保留 GREASE 版本 0x1a2a3a4a 触发服务端返回 Version Negotiation）
    const pkt = Buffer.alloc(1200, 0);
    pkt[0] = 0xc0;
    pkt.writeUInt32BE(0x1a2a3a4a, 1);
    pkt[5] = 8;
    crypto.randomBytes(8).copy(pkt, 6);
    pkt[14] = 8;
    crypto.randomBytes(8).copy(pkt, 15);

    sock.send(pkt, port, host, (err) => {
      if (err) { clearTimeout(timer); finish(false); }
    });
  });
}

async function probeTarget(t) {
  if (t.protocol === 'hy2') {
    const r1 = await quicUdpProbeOnce(t.host, t.port, 1200);
    if (r1.reachable) return { id: t.id, ...r1 };
    const r2 = await quicUdpProbeOnce(t.host, t.port, 1200);
    return { id: t.id, ...r2 };
  }
  const r = await tcpProbe(t.host, t.port, 2500);
  return { id: t.id, ...r };
}

exports.handler = async (event, context) => {
  const panelUrl = (process.env.PANEL_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.OPS_API_KEY || '';
  const originIp = (process.env.PANEL_ORIGIN_IP || '').trim();
  const region = process.env.PROBE_REGION || 'cn-shanghai';

  if (!panelUrl || !apiKey) {
    return { statusCode: 500, body: 'Missing PANEL_URL or OPS_API_KEY env' };
  }

  const targetsResp = await requestJson(`${panelUrl}/ops/api/probe/targets`, 'GET', apiKey, null, originIp);
  const targets = targetsResp?.data?.targets || [];
  if (targets.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, probed: 0 }) };
  }

  // 并发探测所有节点
  const results = await Promise.all(targets.map(probeTarget));
  const reportResp = await requestJson(`${panelUrl}/ops/api/probe/report`, 'POST', apiKey, { region, results }, originIp);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      probed: results.length,
      unreachable: results.filter(r => !r.reachable).map(r => r.id),
      panelReply: reportResp.data,
    }),
  };
};

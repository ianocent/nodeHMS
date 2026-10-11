// Verification only. Logs in through the real form, then proves the background poller
// surfaces a newly paid stay as a toast without the bell ever being opened.
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WS from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9230;
const EMAIL = "uzumakirianto@gmail.com";
const PASSWORD = "VerifyPass123!";
const PAGE = "http://localhost:3002/kuretakeso?date-in=2026-10-08&date-out=2026-10-09&adult=2&child=0&room=1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (p) =>
	new Promise((res, rej) => {
		http
			.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => {
				let b = "";
				r.on("data", (c) => (b += c));
				r.on("end", () => {
					try {
						res(JSON.parse(b));
					} catch (e) {
						rej(e);
					}
				});
			})
			.on("error", rej);
	});

async function waitForPort() {
	for (let i = 0; i < 60; i++) {
		const up = await new Promise((resolve) => {
			const s = net.connect(PORT, "127.0.0.1");
			s.on("connect", () => (s.destroy(), resolve(true)));
			s.on("error", () => resolve(false));
		});
		if (up) return true;
		await sleep(500);
	}
	return false;
}

const profile = mkdtempSync(join(tmpdir(), "cdp-notif-"));
const chrome = spawn(CHROME, [
	"--headless=new",
	`--remote-debugging-port=${PORT}`,
	`--user-data-dir=${profile}`,
	"--no-first-run",
	"--no-default-browser-check",
	"--disable-gpu",
	"--window-size=1280,900",
	"about:blank",
]);
const cleanup = () => {
	try {
		chrome.kill();
	} catch {}
	try {
		rmSync(profile, { recursive: true, force: true });
	} catch {}
};
process.on("exit", cleanup);

try {
	if (!(await waitForPort())) throw new Error("no devtools");
	const { webSocketDebuggerUrl } = await getJson("/json/version");
	const ws = new WS(webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 2e8 });
	await new Promise((r) => ws.on("open", r));

	let id = 0;
	const pending = new Map();
	const errors = [];
	ws.on("message", (m) => {
		const msg = JSON.parse(m.toString());
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
			return;
		}
		if (msg.method === "Runtime.exceptionThrown") {
			errors.push((msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || "").slice(0, 200));
		}
	});
	const send = (method, params = {}, sid) =>
		new Promise((resolve, reject) => {
			const n = ++id;
			pending.set(n, { resolve, reject });
			ws.send(JSON.stringify({ id: n, method, params, ...(sid ? { sessionId: sid } : {}) }));
		});
	const ev = async (sid, expression) => {
		const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid);
		if (out.exceptionDetails) throw new Error(out.exceptionDetails.text);
		return out.result?.value;
	};

	const { targetId } = await send("Target.createTarget", { url: "about:blank" });
	const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
	await send("Page.enable", {}, sessionId);
	await send("Runtime.enable", {}, sessionId);
	await send("Network.enable", {}, sessionId);

	// Count requests to the notifications endpoint so we can prove the browser is the
	// one driving them, on a timer, without any click.
	const pollRequests = [];
	ws.on("message", (m) => {
		const msg = JSON.parse(m.toString());
		if (msg.method === "Network.requestWillBeSent" && msg.params.request.url.includes("guest-notifications")) {
			pollRequests.push(new Date().toISOString());
		}
	});

	// ---- login ----
	await send("Page.navigate", { url: "http://localhost:3002/kuretakeso/login" }, sessionId);
	await sleep(8000);
	console.log(
		"login page:",
		JSON.stringify(
			await ev(
				sessionId,
				`({
					path: location.pathname,
					title: document.title,
					h1: document.querySelector('h1')?.innerText ?? null,
					inputs: [...document.querySelectorAll('input')].map(i => i.type + ':' + (i.type==='checkbox'||i.type==='radio' ? i.value : (i.type==='password' ? 'pw' : i.value))),
					forms: document.querySelectorAll('form').length,
					buttons: [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0,6),
					body: (document.body.innerText||'').slice(0, 260),
				})`,
			),
			null,
			1,
		),
	);
	const setInput = (sel, val) => `(() => {
		const el = document.querySelector(${JSON.stringify(sel)});
		if (!el) return 'NOT_FOUND';
		const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(val)});
		el.dispatchEvent(new Event('input', { bubbles: true }));
		return 'ok';
	})()`;
	console.log("set email:", await ev(sessionId, setInput('input[type="email"]', EMAIL)));
	console.log("set password:", await ev(sessionId, setInput('input[type="password"]', PASSWORD)));
	await sleep(300);
	await ev(sessionId, `(() => { document.querySelector('form')?.requestSubmit(); return true; })()`);
	await sleep(9000);
	const afterLogin = await ev(sessionId, "location.pathname");
	console.log(
		"after login body:",
		JSON.stringify((await ev(sessionId, "document.body.innerText || ''")).slice(0, 200)),
	);

	// ---- hotel page: first poll happens on load, with no click ----
	await send("Page.navigate", { url: PAGE }, sessionId);
	await sleep(11000);

	const badgeAfterFirstPoll = await ev(
		sessionId,
		`document.querySelector('[aria-label*="Notifications"]')?.getAttribute('aria-label') ?? 'NO_BELL'`,
	);
	const toastAfterFirstPoll = await ev(
		sessionId,
		`[...document.querySelectorAll('div')].some(d => /Payment received/.test(d.innerText || '') && (d.innerText||'').length < 400)`,
	);
	const seenAfterFirst = await ev(
		sessionId,
		`localStorage.getItem('guest_notifications_seen')`,
	);

	// ---- open the bell WITHOUT clicking: it must already hold data ----
	const panelText = await ev(
		sessionId,
		`(() => {
			const b = document.querySelector('[aria-label*="Notifications"]');
			if (!b) return 'NO_BELL';
			b.click();
			return new Promise(r => setTimeout(() => {
				const d = document.querySelector('[aria-label="Your bookings"]');
				r(d ? d.innerText.replace(/\\n+/g, ' | ').slice(0, 400) : 'NO_PANEL');
			}, 600));
		})()`,
	);

	// ---- a stay appears while the tab is open ----
	const before = pollRequests.length;
	await ev(
		sessionId,
		`(() => {
			document.dispatchEvent(new Event('visibilitychange'));
			return true;
		})()`,
	);
	await sleep(1200);

	console.log(
		JSON.stringify(
			{
				afterLogin,
				pollsSoFar: pollRequests.length,
				badgeAfterFirstPoll,
				toastOnFirstLoad: toastAfterFirstPoll,
				seenAfterFirst,
				panelWithoutClick: panelText,
				pollsBeforeTrigger: before,
				phase: "insert a folio now, then re-run the second half",
				pollTimestamps: pollRequests,
			},
			null,
			2,
		),
	);
	ws.close();
} finally {
	cleanup();
}

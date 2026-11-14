// Minimal PostgREST stand-in for a live end-to-end check.
import http from "node:http";
const tables = { trackers: [], analyzed_posts: [], monitor_results: [] };
const srv = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const table = url.pathname.replace("/rest/v1/", "");
    const rows = tables[table];
    const body = raw ? JSON.parse(raw) : null;
    if (!rows) { res.writeHead(404, {"content-type":"application/json"}); return res.end(JSON.stringify({message:`relation "public.${table}" does not exist`, code:"42P01"})); }
    if (req.method === "GET") {
      const idEq = url.searchParams.get("id")?.replace("eq.", "");
      const trackerEq = url.searchParams.get("tracker_id")?.replace("eq.", "");
      const out = rows.filter(r => (!idEq || r.id === idEq) && (!trackerEq || r.tracker_id === trackerEq)).slice(0, Number(url.searchParams.get("limit")) || 1000);
      res.writeHead(200, {"content-type":"application/json","content-range":`0-${Math.max(0,out.length-1)}/${out.length}`});
      return res.end(JSON.stringify(out));
    }
    if (req.method === "POST") {
      const incoming = Array.isArray(body) ? body : [body];
      for (const row of incoming) { const i = rows.findIndex(r => r.id === row.id); if (i >= 0) rows[i] = row; else rows.push(row); }
      res.writeHead(201, {"content-type":"application/json"}); return res.end("[]");
    }
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const tracker = url.searchParams.get("tracker_id")?.replace("eq.", "");
      const inList = url.searchParams.get("id")?.startsWith("in.(") ? url.searchParams.get("id").slice(4,-1).split(",") : null;
      for (let i = rows.length - 1; i >= 0; i--) {
        if ((id && rows[i].id === id) || (tracker && rows[i].tracker_id === tracker) || (inList && inList.includes(rows[i].id))) rows.splice(i,1);
      }
      res.writeHead(204); return res.end();
    }
    res.writeHead(405).end();
  });
});
srv.listen(9998, "127.0.0.1", () => console.log("fake supabase on 9998"));

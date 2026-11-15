export const githubOwnerControlPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Badboy · Owner Control Center</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e8f0fa;background:#071426;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 10% 0%,#12345a 0,transparent 40%),#071426}
main{width:min(980px,100% - 32px);margin:0 auto;padding:32px 0 64px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px}
.brand{font-size:12px;letter-spacing:.22em;font-weight:900;color:#53dafa}.muted{color:#9db0c6}.panel{background:#0b1d35;border:1px solid #234363;border-radius:18px;padding:20px;margin:14px 0;box-shadow:0 12px 36px #0003}
h1{font-size:clamp(25px,5vw,36px);margin:6px 0 8px}h2{font-size:18px;margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
label{display:block;font-size:12px;color:#b7c9dc;margin:0 0 6px}input,select{width:100%;background:#061326;color:#f4f8ff;border:1px solid #31516f;border-radius:10px;padding:12px;font:inherit;min-width:0}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}button{border:0;border-radius:10px;padding:11px 15px;font:inherit;font-weight:750;background:#55dafa;color:#071426;cursor:pointer}
button.secondary{background:#193652;color:#e4f2ff;border:1px solid #31516f}button.danger{background:#a92f48;color:white}button:disabled{opacity:.5;cursor:wait}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #203b57}.row:first-child{border-top:0}
.small{font-size:12px;color:#9db0c6;line-height:1.6}.tag{display:inline-block;padding:4px 8px;border-radius:999px;background:#173c57;color:#8fe8ff;font-size:11px;margin:3px}
.status{padding:10px 12px;border-radius:10px;background:#102b45;color:#a8d9ee;margin:12px 0}.status.error{background:#421f2c;color:#ffb5c2}.hidden{display:none!important}
.checks{display:flex;gap:14px;flex-wrap:wrap}.checks label{display:flex;align-items:center;gap:6px;margin:8px 0}.checks input{width:auto}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#b8c9db}
@media(max-width:640px){main{width:min(100% - 22px,980px);padding-top:18px}.grid{grid-template-columns:1fr}.panel{padding:15px}.top{align-items:flex-start;flex-direction:column}.row{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body><main>
<header class="top"><div><div class="brand">BADBOY · OWNER SECURITY</div><h1>Owner Control Center</h1><div class="muted">Repository scope · emergency lockdown · audit trail</div></div><div class="actions"><button id="refresh" class="secondary">Refresh</button><button id="logout" class="secondary hidden">Sign out</button></div></header>
<div id="status" class="status">Checking Owner session…</div>
<section id="signedOut" class="panel hidden"><h2>Connect the Owner GitHub account</h2><p class="muted">Only the numeric GitHub account ID configured in the server allowlist can enter this control center.</p><div class="actions"><button id="login">Continue with GitHub</button></div></section>
<div id="dashboard" class="hidden">
<section class="panel"><div class="row"><div><div class="small">Authenticated Owner</div><strong id="owner">—</strong></div><div><div class="small">Emergency status</div><strong id="lockStatus">—</strong></div></div><div class="actions"><button id="lock" class="danger">Emergency lockdown</button><button id="unlock" class="secondary">Release lockdown</button></div><p class="small">Lockdown blocks both new approvals and consumption of pending approvals. Releasing it is a separate explicit Owner action.</p></section>
<section class="panel"><h2>Grant temporary permission</h2><form id="grantForm">
<div class="grid"><div><label for="repository">Repository (owner/name)</label><input id="repository" required maxlength="140" placeholder="owner/repository"></div><div><label for="branch">Branch pattern</label><input id="branch" required maxlength="250" placeholder="feature/* or main"></div><div><label for="expiry">Permission duration</label><select id="expiry"><option value="3600">1 hour</option><option value="86400">24 hours</option><option value="604800">7 days</option><option value="2592000">30 days</option></select></div><div><label>Allowed write actions</label><div class="checks"><label><input type="checkbox" name="action" value="create-branch"> Create branch</label><label><input type="checkbox" name="action" value="create-draft-pr"> Draft PR</label><label><input type="checkbox" name="action" value="dispatch-workflow"> Workflow</label></div></div></div>
<div class="actions"><button type="submit">Grant permission</button></div></form><p class="small">A grant only narrows scope. Every GitHub write still needs its own exact, one-time Owner approval. Permissions expire automatically.</p></section>
<section class="panel"><h2>Active and historical permissions</h2><div id="permissions" class="muted">Loading…</div></section>
<section class="panel"><h2>Owner audit log</h2><div id="audit" class="muted">Loading…</div></section>
</div>
</main>
<script nonce="__NONCE__">
const API="/api/github", CONTROL=API+"/controls";
const $=id=>document.getElementById(id);
const status=(message,error=false)=>{$("status").textContent=message;$("status").className=error?"status error":"status"};
async function request(path,options={}){const response=await fetch(path,{...options,credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})}});if(response.status===204)return null;const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||data.code||"Request failed");return data}
function renderRows(target,items,kind){const root=$(target);root.replaceChildren();if(!items.length){root.textContent="No records yet.";root.className="muted";return}root.className="";for(const item of items){const row=document.createElement("div");row.className="row";const details=document.createElement("div");const title=document.createElement("strong");title.textContent=kind==="permission"?item.repository+" · "+item.branchPattern:item.action+" · "+item.outcome;details.append(title);const sub=document.createElement("div");sub.className="small";sub.textContent=kind==="permission"?"Actions: "+(item.actions||[]).join(", ")+" · Expires: "+new Date(item.expiresAt).toLocaleString()+(item.revokedAt?" · Revoked":""):item.resource+" · "+new Date(item.createdAt).toLocaleString();details.append(sub);row.append(details);if(kind==="permission"&&!item.revokedAt&&new Date(item.expiresAt)>new Date()){const revoke=document.createElement("button");revoke.className="secondary";revoke.textContent="Revoke";revoke.addEventListener("click",async()=>{if(!confirm("Revoke this permission now? Pending approvals using it will stop working."))return;try{await request(CONTROL+"/permissions/"+encodeURIComponent(item.id),{method:"DELETE"});await refresh()}catch(e){status(e.message,true)}});row.append(revoke)}root.append(row)}}
async function refresh(){try{const [owner,permissions,lockdown,audit]=await Promise.all([request(API+"/me"),request(CONTROL+"/permissions"),request(CONTROL+"/lockdown"),request(CONTROL+"/audit?limit=100")]);$("signedOut").classList.add("hidden");$("dashboard").classList.remove("hidden");$("logout").classList.remove("hidden");$("owner").textContent=owner.login+" · ID "+owner.id;$("lockStatus").textContent=lockdown.locked?"LOCKED":"UNLOCKED";$("lock").disabled=lockdown.locked;$("unlock").disabled=!lockdown.locked;renderRows("permissions",permissions.permissions||[],"permission");renderRows("audit",audit.entries||[],"audit");status("Owner session verified. All controls are scoped to this Owner.")}catch(e){$("dashboard").classList.add("hidden");$("logout").classList.add("hidden");$("signedOut").classList.remove("hidden");status(e.message==="GITHUB_OWNER_SESSION_REQUIRED"?"Connect the allowlisted Owner GitHub account.":e.message,true)}}
$("login").addEventListener("click",()=>{location.assign(API+"/oauth/start")});
$("refresh").addEventListener("click",()=>void refresh());
$("grantForm").addEventListener("submit",async event=>{event.preventDefault();const actions=[...document.querySelectorAll('input[name="action"]:checked')].map(el=>el.value);const payload={repository:$("repository").value.trim(),branchPattern:$("branch").value.trim(),actions,expiresInSeconds:Number($("expiry").value)};if(!actions.length){status("Select at least one allowed action.",true);return}if(!confirm("Grant this temporary permission? Each GitHub write will still require a separate approval."))return;try{await request(CONTROL+"/permissions",{method:"POST",body:JSON.stringify(payload)});$("grantForm").reset();status("Permission granted and audited.");await refresh()}catch(e){status(e.message,true)}});
$("lock").addEventListener("click",async()=>{if(!confirm("EMERGENCY LOCKDOWN: block all GitHub developer approvals and writes for this Owner?"))return;const reason=prompt("Reason for emergency lockdown:","Owner emergency lockdown")||"Owner emergency lockdown";try{await request(CONTROL+"/lockdown",{method:"POST",body:JSON.stringify({reason})});await refresh()}catch(e){status(e.message,true)}});
$("unlock").addEventListener("click",async()=>{if(!confirm("Release emergency lockdown? Owner-scoped permissions will become usable again, but each write still requires a separate approval."))return;try{await request(CONTROL+"/lockdown",{method:"DELETE"});await refresh()}catch(e){status(e.message,true)}});
$("logout").addEventListener("click",async()=>{if(!confirm("Sign out and revoke this server-side Owner session?"))return;try{await request(API+"/oauth/logout",{method:"POST",body:"{}"});location.reload()}catch(e){status(e.message,true)}});
void refresh();
</script>
</body></html>`;

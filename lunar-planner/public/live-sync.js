// Live sync: when the team pushes to GitHub and sync.ps1 / sync.sh pulls it onto this computer, every open
// page (/, /classic, /learn) reloads itself to show the new version. It asks the server which git commit
// the files are on every 30 seconds. Nothing is sent anywhere else.
(function () {
    const EVERY_MS = 30000;
    let first = null;
    let banner = null;

    function busy() {
        // Do not reload in the middle of typing or of a game on /learn.
        const a = document.activeElement;
        const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
        const arena = document.getElementById('arena');
        return typing || (arena && !arena.hidden);
    }

    function show(commit) {
        if (banner) {
            return;
        }
        banner = document.createElement('div');
        banner.setAttribute('role', 'status');
        banner.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;display:flex;gap:12px;'
            + 'align-items:center;padding:10px 14px;border:1px solid #2e2e2e;border-radius:10px;background:rgba(10,10,10,.92);'
            + 'color:#ededed;font:13px system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)';
        const text = document.createElement('span');
        text.textContent = `New version from GitHub (${commit.slice(0, 7)}).`;
        const button = document.createElement('button');
        button.textContent = 'Reload';
        button.style.cssText = 'padding:5px 12px;border:0;border-radius:7px;background:#f5c96b;color:#000;font:600 12px system-ui;cursor:pointer';
        button.onclick = () => window.location.reload();
        banner.append(text, button);
        document.body.append(banner);
        // Reload on its own after 15 s, unless someone is typing or playing.
        const auto = () => (busy() ? setTimeout(auto, 5000) : window.location.reload());
        setTimeout(auto, 15000);
    }

    async function check() {
        try {
            const r = await fetch('/api/health', {cache: 'no-store'});
            const j = await r.json();
            if (!j.commit) {
                return;
            }
            if (first === null) {
                first = j.commit;
            } else if (j.commit !== first) {
                show(j.commit);
            }
        } catch (e) {
            // Server restarting: try again next time.
        }
    }

    check();
    setInterval(check, EVERY_MS);
})();

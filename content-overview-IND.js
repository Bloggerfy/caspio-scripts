window.CaspioApp = {
    // Properties to hold state and configuration
    cfg: {},
    pollInt: null,
    cdInt: null,
    activePops: new Set(),
    dismissedPops: new Set(),
    POLL_MS: 10000,
    isRunning: false,

    // --- Main Initializer ---
    init(caspioConfig) {
        // DEBUG: Check if init is called and what config it received
        console.log("CaspioApp.init() called.", caspioConfig);

        if (this.isRunning) return;
        this.isRunning = true;
        this.cfg = caspioConfig;

        // DEBUG: Check if the config was assigned correctly
        console.log("CaspioApp.cfg assigned:", this.cfg);

        // Run initial tasks
        (async () => {
            // DEBUG: Confirm async tasks are starting
            console.log("Starting async tasks (colorCells, hlRows)...");
            
            this.colorCells();
            try {
                const token = await this.getToken();
                await this.hlRows(token);
            } catch (e) {
                console.error("Init Error:", e);
            }
            this.check();
            this.pollInt = setInterval(() => this.check(), this.POLL_MS);
        })();
    },

    // --- Core Functions (as methods) ---
    // ... (the rest of your functions like showPop, hidePop, etc., remain unchanged)
    
    colorCells() {
        console.log("Running colorCells()..."); // DEBUG
        document.querySelectorAll('input[id^="AI_Content_DB_Content_Status"], input[id^="AI_Content_DB_Content_Instructions"]').forEach(inputElement => {
            const c = inputElement.closest('td');
            if (!c) return;
            let t = c.textContent.trim().toLowerCase();
            if (t.includes("generating") || t === "generated") c.style.color = "#FF8429";
            else if (t.includes("publishing soon")) { c.style.color = "#00bd5e"; }
            else if (t.includes("published")) { c.style.color = "#00bd5e"; c.style.fontWeight = "bold"; }
            else if (t.includes("n/a")) c.style.color = "#a6a6a6";
            else if (t.includes("error") || t.includes("issue")) c.style.color = "#D9534F";
            else if (t.includes("ready to publish")) c.style.color = "#00bd5e";
        });
    },

    async getToken() {
        // DEBUG: Check if getToken is being called
        console.log("Attempting to get token...");
        const r = await fetch(this.cfg.tokenEP, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=client_credentials&client_id=${this.cfg.cliId}&client_secret=[SECRET MASKED]`
        });
        if (!r.ok) throw new Error("Token Error");
        return (await r.json()).access_token;
    },

    async hlRows(tok) {
        console.log("Running hlRows()..."); // DEBUG
        const date = new Date(Date.now() - 600000);
        date.setHours(date.getHours() - 5);
        const t = date.toISOString();
        const whr = `Client_ID='${this.cfg.clientID}' AND Campaign_Date >= '${t}'`;
        
        console.log("Highlight query:", whr); // DEBUG
        
        try {
            const recs = await this.fetchData(tok, this.cfg.contentTable, whr);
            const cells = document.querySelectorAll('td.cbResultSetData');
            recs.forEach(rec => {
                if (rec.Post_ID) {
                    for (const cell of cells) {
                        if (cell.textContent.trim() === String(rec.Post_ID)) {
                            cell.closest('tr')?.setAttribute("style", "background-color: rgb(241, 255, 240) !important");
                            break;
                        }
                    }
                }
            });
        } catch (e) {
            console.error("Highlight Error:", e);
        }
    },

    makePostList(posts, verb) {
        const ids = posts.map(p => `#${p.Post_ID}`);
        if (ids.length === 0) return '';
        if (ids.length === 1) return `Post ${ids[0]} is ${verb}...`;
        if (ids.length === 2) return `Posts ${ids[0]} and ${ids[1]} are ${verb}...`;
        const last = ids.pop();
        return `Posts ${ids.join(', ')}, and ${last} are ${verb}...`;
    },
    
    colorCells() {
        document.querySelectorAll('input[id^="AI_Content_DB_Content_Status"], input[id^="AI_Content_DB_Content_Instructions"]').forEach(inputElement => {
            const c = inputElement.closest('td');
            if (!c) return;
            let t = c.textContent.trim().toLowerCase();
            if (t.includes("generating") || t === "generated") c.style.color = "#FF8429";
            else if (t.includes("publishing soon")) { c.style.color = "#00bd5e"; }
            else if (t.includes("published")) { c.style.color = "#00bd5e"; c.style.fontWeight = "bold"; }
            else if (t.includes("n/a")) c.style.color = "#a6a6a6";
            else if (t.includes("error") || t.includes("issue")) c.style.color = "#D9534F";
            else if (t.includes("ready to publish")) c.style.color = "#00bd5e";
        });
    },

    async check() {
        if (!this.cfg.clientID || this.cfg.clientID.startsWith('[@')) {
            clearInterval(this.pollInt);
            return;
        }
        try {
            const tok = await this.getToken();
            const regRecs = await this.fetchData(tok, this.cfg.regTable, `Client_ID='${this.cfg.clientID}'`);
            if (regRecs.length > 0) {
                const s = (regRecs[0].Campaign_Running || '').toLowerCase().trim();
                if (s === 'campaign generating...') {
                    this.showPop('campaign-status-popup', { title: 'Campaign is generating...', timerText: `Checking status in ${this.POLL_MS / 1000} seconds...`, statusType: 'default' });
                    this.countdown('campaign-status-popup', this.POLL_MS / 1000);
                } else if (s === 'campaign completed') {
                    clearInterval(this.pollInt);
                    this.showPop('campaign-status-popup', { title: 'Campaign Completed!', displayType: 'flex', statusType: 'completed', button: { text: 'Refresh', onClick: async () => { try { const t = await this.getToken(); await fetch(`${this.cfg.base}/tables/${this.cfg.regTable}/records?q.where=Client_ID='${this.cfg.clientID}'`, { method: 'PUT', headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ Campaign_Running: '' }) }); } finally { location.reload(); } } } });
                } else {
                    this.hidePop('campaign-status-popup');
                }
            }
            const statuses = ["generating", "issue", "error", "publishing soon"];
            const statusClauses = statuses.map(s => `Content_Status LIKE '%${s}%'`).join(' OR ');
            const postWhereClause = `Client_ID=${this.cfg.clientID} AND (${statusClauses})`;
            const postRecs = await this.fetchData(tok, this.cfg.contentTable, postWhereClause);
            const genPosts = postRecs.filter(p => (p.Content_Status || '').toLowerCase().includes('generating'));
            const errPosts = postRecs.filter(p => (p.Content_Status || '').toLowerCase().includes('issue') || (p.Content_Status || '').toLowerCase().includes('error'));
            const pubSoonPosts = postRecs.filter(p => (p.Content_Status || '').toLowerCase().includes('publishing soon'));
            const currentPopIds = new Set();
            if (this.activePops.has('campaign-status-popup')) currentPopIds.add('campaign-status-popup');
            if (genPosts.length > 0) {
                const id = 'generating-group';
                this.showPop(id, { title: this.makePostList(genPosts, 'generating'), statusType: 'generating' });
                currentPopIds.add(id);
            }
            if (errPosts.length > 0) {
                const id = 'error-group';
                this.showPop(id, { title: this.makePostList(errPosts, 'experiencing issues'), statusType: 'error' });
                currentPopIds.add(id);
            }
            if (pubSoonPosts.length > 0) {
                const id = 'publishing-soon-group';
                this.showPop(id, { title: this.makePostList(pubSoonPosts, 'publishing soon'), statusType: 'publishing-soon' });
                currentPopIds.add(id);
            }
            this.activePops.forEach(id => {
                if (!currentPopIds.has(id)) this.hidePop(id);
            });
        } catch (e) {
            console.error("Check Error:", e);
        }
    }
};

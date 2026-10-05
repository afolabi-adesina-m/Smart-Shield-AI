/* Optional sign-in. The server stays open unless AUTH_REQUIRED is on. */
(function () {
  const KEY = "smartshield.authToken.v1";
  const nativeFetch = window.fetch.bind(window);

  function readToken() {
    try { return localStorage.getItem(KEY) || ""; } catch (err) { return ""; }
  }

  function writeToken(token) {
    try {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    } catch (err) { /* private mode */ }
  }

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const token = readToken();
    const sameApi = url.indexOf("/api/") !== -1;
    if (!token || !sameApi || url.indexOf("/api/auth/login") !== -1) {
      return nativeFetch(input, init);
    }
    const headers = new Headers((init && init.headers) || (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
    if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);
    const next = Object.assign({}, init, { headers: headers });
    return nativeFetch(input, next);
  };

  function gate() {
    let node = document.getElementById("auth-gate");
    if (node) return node;
    node = document.createElement("div");
    node.id = "auth-gate";
    node.className = "auth-gate";
    node.innerHTML = `
      <form class="auth-card" id="auth-form">
        <h2>Sign in</h2>
        <p>This server is asking for the demo admin account. Health checks stay open.</p>
        <label for="auth-user">Username</label>
        <input id="auth-user" name="username" autocomplete="username" />
        <label for="auth-pass">Password</label>
        <input id="auth-pass" name="password" type="password" autocomplete="current-password" />
        <p id="auth-error" class="auth-error" hidden></p>
        <button class="route-start" type="submit">Sign in</button>
      </form>`;
    document.body.appendChild(node);
    node.querySelector("#auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = node.querySelector("#auth-error");
      error.hidden = true;
      const username = node.querySelector("#auth-user").value.trim();
      const password = node.querySelector("#auth-pass").value;
      try {
        const response = await nativeFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ username: username, password: password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          error.textContent = data.error || "Sign in failed.";
          error.hidden = false;
          return;
        }
        writeToken(data.token || "");
        node.hidden = true;
        addSignOut();
      } catch (err) {
        error.textContent = "The server did not answer. If it was asleep, try again in a minute.";
        error.hidden = false;
      }
    });
    return node;
  }

  function addSignOut() {
    const card = document.querySelector(".nav-settings-card");
    if (!card || document.getElementById("auth-sign-out")) return;
    const button = document.createElement("button");
    button.id = "auth-sign-out";
    button.type = "button";
    button.className = "route-start";
    button.textContent = "Sign out";
    button.addEventListener("click", async () => {
      writeToken("");
      try { await nativeFetch("/api/auth/logout", { method: "POST" }); } catch (err) { /* still local */ }
      window.location.reload();
    });
    const fine = card.querySelector(".fine-print");
    if (fine) card.insertBefore(button, fine);
    else card.appendChild(button);
  }

  async function boot() {
    let status;
    try {
      status = await nativeFetch("/api/auth/status", { headers: { Accept: "application/json" } }).then((response) => response.json());
    } catch (err) {
      return;
    }
    if (!status || !status.auth_required) return;
    const token = readToken();
    if (token) {
      try {
        const check = await nativeFetch("/api/auth/status", {
          headers: { Accept: "application/json", Authorization: "Bearer " + token },
        }).then((response) => response.json());
        if (check && check.authenticated) {
          addSignOut();
          return;
        }
      } catch (err) { /* ask again */ }
      writeToken("");
    }
    gate().hidden = false;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

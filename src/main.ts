import "./style.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Missing #app host element");
}

app.innerHTML = `
  <section class="bootstrap" aria-live="polite">
    <h1>INTERLIS Web IDE</h1>
    <p>Workspace services are loading…</p>
  </section>
`;

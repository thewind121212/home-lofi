'use client'

// The page's own error and 404 screens (app/error.js, app/global-error.js, app/not-found.js): a big code, a line or
// two, the ways out, over a slow lofi sky that drifts (glows moving, stars twinkling; still with reduced motion).
// Self-contained (app/oops.css, its own colours and fonts): the global error replaces the whole layout, globals.css
// included.
import './oops.css'

const STARS = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  top: (i * 53 + 7) % 70,
  size: 1 + ((i * 7) % 3),
  delay: (i * 0.37) % 4,
}))

// code: the big word ("404", "Oops"); actions: [{ label, onClick?, href?, primary? }]
export function Oops({ code, title, text, actions = [] }) {
  return (
    <main className="oops">
      <div className="oops-sky" aria-hidden="true">
        <span className="oops-glow a" />
        <span className="oops-glow b" />
        <span className="oops-glow c" />
        {STARS.map((s, i) => (
          <i key={i} className="oops-star" style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s` }} />
        ))}
        <span className="oops-hills" />
      </div>
      <section className="oops-card">
        <p className="oops-code">{code}</p>
        <h1>{title}</h1>
        {text && <p className="oops-text">{text}</p>}
        <div className="oops-acts">
          {actions.map((a) =>
            a.href ? (
              <a key={a.label} className={`oops-btn${a.primary ? ' primary' : ''}`} href={a.href}>{a.label}</a>
            ) : (
              <button key={a.label} type="button" className={`oops-btn${a.primary ? ' primary' : ''}`} onClick={a.onClick}>{a.label}</button>
            ),
          )}
        </div>
      </section>
    </main>
  )
}

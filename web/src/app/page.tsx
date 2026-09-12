import Link from "next/link";
import ParticleScene from "@/components/particle-scene";

export default function Home() {
  const workspace = process.env.NEXT_PUBLIC_APP_URL || "/workspace";

  return (
    <main className="landing">
      <header className="landing-nav">
        <Link href="/" className="wordmark" aria-label="Autov home">
          <span className="brand-symbol">a</span>autov<span className="wordmark-dot">.</span>
        </Link>
        <Link href={workspace} className="nav-link">Open workspace <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="hero">
        <div className="hero-art"><ParticleScene animated /></div>
        <div className="hero-copy">
          <h1>Your workspace<br />for <em>3D effects.</em></h1>
          <p>Bring your image references and prompts together<br />in one place, built for real-time visual effects.</p>
          <Link className="primary-link" href={workspace}>Get started <span aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <section className="landing-bottom" aria-label="Workspace features">
        <div className="manifesto"><h2>Everything starts<br />with a reference.</h2></div>
        <div className="process-item">
          <p>Add image references</p>
          <small>Collect images that capture the look, color, and texture of your effect.</small>
        </div>
        <div className="process-item">
          <p>Describe your effect</p>
          <small>Write a prompt to define its appearance and motion.</small>
        </div>
        <div className="process-item">
          <p>Save your progress</p>
          <small>Keep references and prompts organized in projects you can return to.</small>
        </div>
      </section>

      <footer className="landing-footer"><span>Autov — A workspace for real-time VFX.</span></footer>
    </main>
  );
}

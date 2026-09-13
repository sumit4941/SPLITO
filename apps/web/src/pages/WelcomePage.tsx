import { Button, SplitoLogo } from '@splito/ui';
import { ArrowRight, Check, LockKeyhole, Orbit, ReceiptText, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';

export default function WelcomePage() {
  return (
    <main className="welcome">
      <header className="welcome__nav">
        <Link aria-label="SPLITO overview" to="/">
          <SplitoLogo />
        </Link>
        <Button asChild variant="secondary">
          <Link to="/login">Sign in</Link>
        </Button>
      </header>
      <section className="welcome__hero">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 18 }}
          transition={{ duration: 0.5 }}
        >
          <span className="welcome__eyebrow">
            <Sparkles aria-hidden="true" size={16} /> Shared money, less awkward
          </span>
          <h1>
            Keep every shared expense <em>in balance.</em>
          </h1>
          <p>
            SPLITO gives trips, homes, couples, and friends one calm place to record costs,
            understand balances, and settle with confidence.
          </p>
          <div className="welcome__actions">
            <Button asChild icon={ArrowRight} size="lg">
              <Link to="/login">Enter your orbit</Link>
            </Button>
            <span>
              <LockKeyhole aria-hidden="true" size={15} /> Private by default
            </span>
          </div>
        </motion.div>
        <motion.div
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          aria-label="SPLITO product principles"
          className="welcome__visual"
          initial={{ opacity: 0, scale: 0.92, rotate: 2 }}
          transition={{ delay: 0.15, duration: 0.55 }}
        >
          <div className="orbit-ring orbit-ring--one" />
          <div className="orbit-ring orbit-ring--two" />
          <div className="welcome__glass">
            <span className="welcome__glass-icon">
              <Orbit aria-hidden="true" />
            </span>
            <small>Shared dinner</small>
            <strong>Exact, balanced allocations</strong>
            <div className="welcome__people">
              <span>AK</span>
              <span>SM</span>
              <span>JR</span>
              <span>+2</span>
            </div>
            <p>
              <Check aria-hidden="true" size={15} /> Every minor unit reconciles
            </p>
          </div>
        </motion.div>
      </section>
      <section aria-label="Product highlights" className="welcome__features">
        <article>
          <ReceiptText aria-hidden="true" />
          <strong>Flexible splits</strong>
          <p>Equal, exact, percentage, shares, adjustments, and itemized receipts.</p>
        </article>
        <article>
          <Orbit aria-hidden="true" />
          <strong>Currency stays honest</strong>
          <p>Original balances remain independent; estimates always show their basis.</p>
        </article>
        <article>
          <LockKeyhole aria-hidden="true" />
          <strong>History is preserved</strong>
          <p>Edits and settlements remain auditable instead of rewriting the past.</p>
        </article>
      </section>
    </main>
  );
}

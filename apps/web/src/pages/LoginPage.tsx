import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, SplitoLogo, StatusBadge, cn } from '@splito/ui';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  LockKeyhole,
  MessageCircleMore,
  MoonStar,
  Orbit,
  Pencil,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  WifiOff,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, friendlyApiError } from '../api/client';
import {
  dialingCountries,
  formatCountdown,
  maskMobileNumber,
  normalizeMobileNumber,
  sanitizeOtp,
} from '../auth/mobile';
import { safeInternalDestination } from '../lib/invitations';
import { useTheme } from '../providers/ThemeProvider';

type LoginStep = 'mobile' | 'otp' | 'success';

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function ThemeButton() {
  const { preference, setPreference } = useTheme();
  const next = preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light';
  return (
    <button
      aria-label={`Theme is ${preference}. Change to ${next}.`}
      className="otp-theme-button"
      onClick={() => setPreference(next)}
      type="button"
    >
      {preference === 'dark' ? <MoonStar aria-hidden="true" /> : <Sun aria-hidden="true" />}
      <span>{preference}</span>
    </button>
  );
}

function SessionCheck() {
  return (
    <main className="otp-session-check" aria-live="polite">
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        initial={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.25 }}
      >
        <SplitoLogo compact />
        <span className="otp-session-check__orbit" />
      </motion.div>
      <p>Checking your secure session…</p>
    </main>
  );
}

function OtpInput({
  disabled,
  invalid,
  onChange,
  value,
}: {
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <label className="otp-code-field">
      <span className="otp-code-field__label">6-digit verification code</span>
      <span className="otp-code-cells" onClick={() => inputRef.current?.focus()}>
        {Array.from({ length: 6 }, (_, index) => (
          <span
            aria-hidden="true"
            className={cn(
              'otp-code-cell',
              value[index] && 'otp-code-cell--filled',
              value.length === index && 'otp-code-cell--active',
            )}
            key={index}
          >
            {value[index] ?? ''}
          </span>
        ))}
        <input
          aria-describedby="otp-code-help"
          aria-invalid={invalid}
          autoComplete="one-time-code"
          className="otp-code-input"
          disabled={disabled}
          inputMode="numeric"
          name="one-time-code"
          onChange={(event) => onChange(sanitizeOtp(event.target.value))}
          pattern="[0-9]*"
          ref={inputRef}
          type="text"
          value={value}
        />
      </span>
      <span className="otp-code-field__help" id="otp-code-help">
        Paste or autofill the complete code. Only digits are accepted.
      </span>
    </label>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const online = useOnlineStatus();
  const systemReducedMotion = useReducedMotion();
  const { reducedMotion } = useTheme();
  const shouldReduceMotion = Boolean(systemReducedMotion || reducedMotion);
  const session = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false });
  const [step, setStep] = useState<LoginStep>('mobile');
  const [countryCode, setCountryCode] = useState('IN');
  const [nationalNumber, setNationalNumber] = useState('');
  const [submittedNumber, setSubmittedNumber] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [maskedNumber, setMaskedNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [developmentCode, setDevelopmentCode] = useState<string>();
  const [mobileError, setMobileError] = useState<string>();
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [newAccount, setNewAccount] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const country = useMemo(
    () => dialingCountries.find((item) => item.code === countryCode) ?? dialingCountries[0],
    [countryCode],
  );
  const destination = safeInternalDestination((location.state as { from?: string } | null)?.from);

  useEffect(() => {
    if (step !== 'otp' || secondsRemaining <= 0) return;
    const timer = window.setInterval(
      () => setSecondsRemaining((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [secondsRemaining, step]);

  const requestOtp = useMutation({
    mutationFn: (mobileNumber: string) => api.requestOtp({ mobileNumber }),
    onSuccess(result, mobileNumber) {
      const code = sanitizeOtp(result.developmentOtp ?? '');
      setSubmittedNumber(mobileNumber);
      setChallengeId(result.challengeId);
      setMaskedNumber(result.maskedMobileNumber ?? maskMobileNumber(mobileNumber));
      setSecondsRemaining(result.resendAfterSeconds ?? 30);
      setDevelopmentCode(code.length === 6 ? code : undefined);
      setOtp('');
      setStep('otp');
      setMobileError(undefined);
    },
  });

  const verifyOtp = useMutation({
    mutationFn: () =>
      api.verifyOtp({
        challengeId,
        deviceName: 'SPLITO web',
        locale: navigator.language,
        mobileNumber: submittedNumber,
        otp,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    onSuccess(result) {
      queryClient.setQueryData(['me'], result.user);
      setNewAccount(result.isNewAccount);
      setStep('success');
      window.setTimeout(
        () => navigate(destination, { replace: true }),
        shouldReduceMotion ? 250 : 1_150,
      );
    },
  });

  const sendCode = () => {
    requestOtp.reset();
    setDevelopmentCode(undefined);
    const mobileNumber = normalizeMobileNumber(country.dialCode, nationalNumber);
    if (!mobileNumber) {
      setMobileError('Enter a valid mobile number, including its area or network code.');
      phoneInputRef.current?.focus();
      return;
    }
    if (!online) {
      setMobileError('Reconnect to request a secure verification code.');
      return;
    }
    setMobileError(undefined);
    requestOtp.mutate(mobileNumber);
  };

  const editNumber = () => {
    verifyOtp.reset();
    requestOtp.reset();
    setOtp('');
    setDevelopmentCode(undefined);
    setChallengeId('');
    setStep('mobile');
    window.setTimeout(() => phoneInputRef.current?.focus(), 100);
  };

  const resend = () => {
    if (secondsRemaining > 0 || requestOtp.isPending || !online) return;
    verifyOtp.reset();
    requestOtp.mutate(submittedNumber);
  };

  if (session.isLoading) return <SessionCheck />;
  if (session.data) return <Navigate replace to={destination} />;

  const sessionUnavailable =
    session.error && !(session.error instanceof ApiError && session.error.status === 401);
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number] };

  return (
    <main className="otp-auth">
      <a className="skip-link" href="#otp-login-panel">
        Skip to sign in
      </a>
      <div aria-hidden="true" className="otp-auth__aurora otp-auth__aurora--violet" />
      <div aria-hidden="true" className="otp-auth__aurora otp-auth__aurora--cyan" />
      <div aria-hidden="true" className="otp-auth__grain" />

      <header className="otp-auth__header">
        <SplitoLogo />
        <ThemeButton />
      </header>

      <section className="otp-auth__story" aria-label="About SPLITO">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 16 }}
          transition={transition}
        >
          <span className="otp-story-kicker">
            <Sparkles aria-hidden="true" /> Shared money, made lighter
          </span>
          <h1>
            Your people.
            <br />
            Your plans.
            <br />
            <em>One clear orbit.</em>
          </h1>
          <p>
            Step into the calmest way to track shared costs, understand balances, and settle without
            the awkward maths.
          </p>
        </motion.div>

        <div aria-hidden="true" className="otp-orbit-art">
          <motion.span
            animate={shouldReduceMotion ? undefined : { rotate: 360 }}
            className="otp-orbit-art__ring otp-orbit-art__ring--outer"
            transition={{ duration: 28, ease: 'linear', repeat: Infinity }}
          >
            <i className="otp-orbit-person otp-orbit-person--coral">A</i>
          </motion.span>
          <motion.span
            animate={shouldReduceMotion ? undefined : { rotate: -360 }}
            className="otp-orbit-art__ring otp-orbit-art__ring--inner"
            transition={{ duration: 20, ease: 'linear', repeat: Infinity }}
          >
            <i className="otp-orbit-person otp-orbit-person--cyan">S</i>
          </motion.span>
          <span className="otp-orbit-art__core">
            <SplitoLogo compact />
          </span>
          <span className="otp-orbit-pill otp-orbit-pill--top">
            <Check /> Every rupee accounted for
          </span>
          <span className="otp-orbit-pill otp-orbit-pill--bottom">
            <Orbit /> Built for real groups
          </span>
        </div>

        <div className="otp-story-trust">
          <span>
            <ShieldCheck aria-hidden="true" />
            <strong>Private by design</strong>
            <small>Secure server sessions</small>
          </span>
          <span>
            <Clock3 aria-hidden="true" />
            <strong>Quick to enter</strong>
            <small>No password to remember</small>
          </span>
          <span>
            <MessageCircleMore aria-hidden="true" />
            <strong>Human by default</strong>
            <small>Clear, original language</small>
          </span>
        </div>
      </section>

      <section className="otp-auth__panel-wrap" id="otp-login-panel">
        <div className="otp-auth__panel-glow" aria-hidden="true" />
        <div className="otp-auth__panel">
          <div
            className="otp-progress"
            aria-label={`Sign-in step ${step === 'mobile' ? 1 : 2} of 2`}
          >
            <span className="otp-progress__bar">
              <i className={cn(step !== 'mobile' && 'otp-progress__bar--complete')} />
            </span>
            <small>
              {step === 'mobile' ? 'Step 1 of 2' : step === 'otp' ? 'Step 2 of 2' : 'Verified'}
            </small>
          </div>

          <AnimatePresence initial={false} mode="wait">
            {step === 'mobile' && (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="otp-step"
                exit={{ opacity: 0, x: shouldReduceMotion ? 0 : -18 }}
                initial={{ opacity: 0, x: shouldReduceMotion ? 0 : 18 }}
                key="mobile"
                transition={transition}
              >
                <div className="otp-step__heading">
                  <span className="otp-step__icon">
                    <Phone aria-hidden="true" />
                  </span>
                  <div>
                    <span className="eyebrow">Welcome to SPLITO</span>
                    <h2>Let's find your orbit</h2>
                  </div>
                  <p>
                    Enter your mobile number. We’ll text a one-time code to sign you in securely.
                  </p>
                </div>

                {searchParams.get('logout') === 'complete' && (
                  <div className="otp-auth-notice otp-auth-notice--success" role="status">
                    <Check />
                    Signed out and local account data cleared.
                  </div>
                )}
                {searchParams.get('logout') === 'local-only' && (
                  <div className="otp-auth-notice otp-auth-notice--warning" role="alert">
                    <WifiOff />
                    <span>
                      <strong>Local data cleared</strong>
                      <small>Reconnect later to confirm remote session revocation.</small>
                    </span>
                  </div>
                )}
                {sessionUnavailable && (
                  <div className="otp-auth-notice otp-auth-notice--warning" role="status">
                    <WifiOff />
                    <span>
                      <strong>Session check unavailable</strong>
                      <small>You can still try mobile verification.</small>
                    </span>
                  </div>
                )}
                {(mobileError || requestOtp.error) && (
                  <ErrorState
                    description={mobileError ?? friendlyApiError(requestOtp.error)}
                    title="Code not sent"
                  />
                )}

                <form
                  className="otp-mobile-form"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendCode();
                  }}
                >
                  <label htmlFor="mobile-number">Mobile number</label>
                  <div
                    className={cn(
                      'otp-mobile-control',
                      (mobileError || requestOtp.error) && 'otp-mobile-control--error',
                    )}
                  >
                    <label className="sr-only" htmlFor="country-code">
                      Country calling code
                    </label>
                    <span className="otp-country-select">
                      <select
                        aria-label="Country calling code"
                        id="country-code"
                        onChange={(event) => setCountryCode(event.target.value)}
                        value={countryCode}
                      >
                        {dialingCountries.map((item) => (
                          <option key={item.code} value={item.code}>
                            {item.flag} {item.name} ({item.dialCode})
                          </option>
                        ))}
                      </select>
                      <span aria-hidden="true">
                        {country.flag} {country.dialCode}
                        <ChevronDown />
                      </span>
                    </span>
                    <input
                      aria-describedby="mobile-number-help"
                      aria-invalid={Boolean(mobileError || requestOtp.error)}
                      autoComplete="tel-national"
                      autoFocus
                      id="mobile-number"
                      inputMode="tel"
                      onChange={(event) => {
                        setNationalNumber(event.target.value.replace(/[^\d\s()-]/g, ''));
                        setMobileError(undefined);
                        requestOtp.reset();
                      }}
                      placeholder={country.example}
                      ref={phoneInputRef}
                      type="tel"
                      value={nationalNumber}
                    />
                  </div>
                  <span id="mobile-number-help">
                    Standard SMS rates may apply. Your number is never shown in a public directory.
                  </span>
                  <Button busy={requestOtp.isPending} disabled={!online} size="lg" type="submit">
                    {requestOtp.isPending ? (
                      'Sending secure code…'
                    ) : (
                      <>
                        Continue <ArrowRight aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="otp-auto-account">
                  <Sparkles aria-hidden="true" />
                  <span>
                    <strong>New here? You’re covered.</strong>
                    <small>
                      Your first successful verification can create your SPLITO account
                      automatically.
                    </small>
                  </span>
                </div>
                <p className="otp-terms">
                  By continuing, you agree to this deployment’s terms and privacy notice.
                </p>
              </motion.div>
            )}

            {step === 'otp' && (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="otp-step"
                exit={{ opacity: 0, x: shouldReduceMotion ? 0 : -18 }}
                initial={{ opacity: 0, x: shouldReduceMotion ? 0 : 18 }}
                key="otp"
                transition={transition}
              >
                <button className="otp-edit-number" onClick={editNumber} type="button">
                  <ArrowLeft />
                  Back
                </button>
                <div className="otp-step__heading otp-step__heading--center">
                  <span className="otp-step__icon">
                    <MessageCircleMore aria-hidden="true" />
                  </span>
                  <div>
                    <span className="eyebrow">Check your messages</span>
                    <h2>Enter the code</h2>
                  </div>
                  <p>
                    We sent a six-digit verification code to <strong>{maskedNumber}</strong>.
                  </p>
                  <button className="otp-inline-edit" onClick={editNumber} type="button">
                    <Pencil />
                    Edit number
                  </button>
                </div>

                {requestOtp.error && (
                  <ErrorState
                    description={friendlyApiError(requestOtp.error)}
                    title="New code not sent"
                  />
                )}
                {verifyOtp.error && (
                  <ErrorState
                    description={friendlyApiError(verifyOtp.error)}
                    title="That code didn't work"
                  />
                )}

                {developmentCode && (
                  <div className="otp-development-code" role="note">
                    <span>
                      <Sparkles aria-hidden="true" />
                    </span>
                    <div>
                      <strong>Development sign-in code</strong>
                      <small>
                        This local test code is available only when development sign-in is enabled.
                      </small>
                    </div>
                    <button
                      onClick={() => {
                        setOtp(developmentCode);
                        verifyOtp.reset();
                      }}
                      type="button"
                    >
                      Use code
                    </button>
                  </div>
                )}

                <form
                  className="otp-verify-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (otp.length === 6 && !verifyOtp.isPending) verifyOtp.mutate();
                  }}
                >
                  <OtpInput
                    disabled={verifyOtp.isPending}
                    invalid={Boolean(verifyOtp.error)}
                    onChange={(value) => {
                      setOtp(value);
                      verifyOtp.reset();
                    }}
                    value={otp}
                  />
                  <Button
                    busy={verifyOtp.isPending}
                    disabled={otp.length !== 6 || !online}
                    size="lg"
                    type="submit"
                  >
                    {verifyOtp.isPending ? (
                      'Verifying…'
                    ) : (
                      <>
                        Verify & continue <ArrowRight aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="otp-resend" aria-live="polite">
                  {secondsRemaining > 0 ? (
                    <span>
                      Didn't get it? Resend in <strong>{formatCountdown(secondsRemaining)}</strong>
                    </span>
                  ) : (
                    <button
                      disabled={requestOtp.isPending || !online}
                      onClick={resend}
                      type="button"
                    >
                      <RefreshCw />
                      Resend code
                    </button>
                  )}
                </div>
                <div className="otp-security-note">
                  <LockKeyhole aria-hidden="true" />
                  <span>
                    This one-time code expires quickly and cannot be reused after successful
                    verification.
                  </span>
                </div>
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div
                animate={{ opacity: 1, scale: 1 }}
                className="otp-success"
                initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.88 }}
                key="success"
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 210, damping: 18 }
                }
              >
                <div className="otp-success__mark">
                  <motion.span
                    animate={shouldReduceMotion ? undefined : { scale: [0.6, 1.08, 1] }}
                    transition={{ duration: 0.5 }}
                  >
                    <Check aria-hidden="true" />
                  </motion.span>
                  <i aria-hidden="true" />
                  <i aria-hidden="true" />
                  <i aria-hidden="true" />
                </div>
                <StatusBadge tone="positive">Identity verified</StatusBadge>
                <h2>{newAccount ? 'Your orbit is ready' : 'Welcome back'}</h2>
                <p>
                  {newAccount
                    ? 'Your SPLITO account was created securely.'
                    : 'Taking you to your latest balances.'}
                </p>
                <span className="otp-success__loading">
                  <i />
                  Opening dashboard…
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <footer className="otp-panel-footer">
            <ShieldCheck aria-hidden="true" />
            OTP verification creates a secure, HttpOnly server session.
          </footer>
        </div>
      </section>
    </main>
  );
}

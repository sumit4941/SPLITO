import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Button, ErrorState, Field, SelectField, SplitoLogo, StatusBadge } from '@splito/ui';
import { ArrowLeft, Check, KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { api, friendlyApiError } from '../api/client';
import { supportedCurrencies } from '../lib/money';

const registerSchema = z
  .object({
    displayName: z.string().trim().min(2, 'Enter the name people will recognize.').max(120),
    email: z.email('Enter a valid email address.'),
    password: z.string().min(12, 'Use at least 12 characters.').max(256),
    confirmPassword: z.string(),
    defaultCurrency: z.string().length(3),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

type RegisterValues = z.infer<typeof registerSchema>;

function AuthStory({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="auth-page__story">
      <Link aria-label="SPLITO welcome" to="/welcome">
        <SplitoLogo />
      </Link>
      <div>
        <span className="eyebrow">Start in balance</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

export function RegisterPage() {
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      confirmPassword: '',
      defaultCurrency: 'INR',
      displayName: '',
      email: '',
      password: '',
    },
  });
  const registerAccount = useMutation({
    mutationFn: (values: RegisterValues) =>
      api.register({
        defaultCurrency: values.defaultCurrency,
        displayName: values.displayName.trim(),
        email: values.email,
        locale: navigator.language,
        password: values.password,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
  });
  return (
    <main className="auth-page">
      <AuthStory
        subtitle="Create a verified identity before inviting people or posting shared financial records."
        title="A shared orbit starts with you."
      >
        <small>
          <ShieldCheck aria-hidden="true" size={15} /> Verification prevents accidental
          guest-identity merges.
        </small>
      </AuthStory>
      <section className="auth-page__form-wrap">
        <Link className="auth-page__back" to="/login">
          <ArrowLeft aria-hidden="true" size={17} /> Sign in
        </Link>
        {registerAccount.data ? (
          <div className="auth-result">
            <span>
              <Mail aria-hidden="true" />
            </span>
            <StatusBadge tone="positive">
              <Check aria-hidden="true" size={12} />
              Account created
            </StatusBadge>
            <h2>Check your email</h2>
            <p>
              {registerAccount.data.message ??
                'Open the single-use verification link we sent before signing in.'}
            </p>
            <Button asChild>
              <Link to="/login">Return to sign in</Link>
            </Button>
          </div>
        ) : (
          <form
            className="auth-form"
            noValidate
            onSubmit={form.handleSubmit((values) => registerAccount.mutate(values))}
          >
            <div>
              <span className="eyebrow">Create account</span>
              <h2>Join SPLITO</h2>
              <p>No ads, artificial expense limits, or public email directory.</p>
            </div>
            {registerAccount.error && (
              <ErrorState
                description={friendlyApiError(registerAccount.error)}
                title="Account not created"
              />
            )}
            <Field
              error={form.formState.errors.displayName?.message}
              label="Your name"
              leading={<UserRound aria-hidden="true" size={18} />}
              {...form.register('displayName')}
            />
            <Field
              autoComplete="email"
              error={form.formState.errors.email?.message}
              label="Email address"
              leading={<Mail aria-hidden="true" size={18} />}
              type="email"
              {...form.register('email')}
            />
            <div className="form-grid form-grid--two">
              <Field
                autoComplete="new-password"
                error={form.formState.errors.password?.message}
                label="Password"
                leading={<KeyRound aria-hidden="true" size={18} />}
                type="password"
                {...form.register('password')}
              />
              <Field
                autoComplete="new-password"
                error={form.formState.errors.confirmPassword?.message}
                label="Confirm password"
                type="password"
                {...form.register('confirmPassword')}
              />
            </div>
            <SelectField label="Default currency" {...form.register('defaultCurrency')}>
              {supportedCurrencies.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </SelectField>
            <Button busy={registerAccount.isPending} size="lg" type="submit">
              Create verified account
            </Button>
            <p className="auth-form__foot">
              By continuing, you agree to the service terms and privacy notice configured for this
              deployment.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}

const requestSchema = z.object({ email: z.email('Enter a valid email address.') });
const resetSchema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters.'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export function PasswordResetPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const requestForm = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: '' },
  });
  const resetForm = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { confirmPassword: '', password: '' },
  });
  const requestReset = useMutation({ mutationFn: api.requestPasswordReset });
  const confirmReset = useMutation({
    mutationFn: (values: z.infer<typeof resetSchema>) =>
      api.resetPassword({ password: values.password, token: token! }),
  });
  return (
    <main className="auth-page">
      <AuthStory
        subtitle="Reset responses stay generic, and every token is expiring and single-use."
        title="Recover access, safely."
      >
        <small>
          <ShieldCheck aria-hidden="true" size={15} /> Recovery never reveals whether an address
          exists.
        </small>
      </AuthStory>
      <section className="auth-page__form-wrap">
        <Link className="auth-page__back" to="/login">
          <ArrowLeft aria-hidden="true" size={17} /> Sign in
        </Link>
        {!token ? (
          <form
            className="auth-form"
            noValidate
            onSubmit={requestForm.handleSubmit((values) => requestReset.mutate(values))}
          >
            <div>
              <span className="eyebrow">Password recovery</span>
              <h2>Request a reset link</h2>
              <p>If the account is eligible, instructions will arrive by email.</p>
            </div>
            {requestReset.error && (
              <ErrorState
                description={friendlyApiError(requestReset.error)}
                title="Request not completed"
              />
            )}
            {requestReset.data ? (
              <div className="saved-callout" role="status">
                <Check aria-hidden="true" />
                If an eligible account exists, reset instructions have been sent.
              </div>
            ) : (
              <>
                <Field
                  autoComplete="email"
                  error={requestForm.formState.errors.email?.message}
                  label="Email address"
                  leading={<Mail aria-hidden="true" size={18} />}
                  type="email"
                  {...requestForm.register('email')}
                />
                <Button busy={requestReset.isPending} size="lg" type="submit">
                  Send reset instructions
                </Button>
              </>
            )}
          </form>
        ) : (
          <form
            className="auth-form"
            noValidate
            onSubmit={resetForm.handleSubmit((values) => confirmReset.mutate(values))}
          >
            <div>
              <span className="eyebrow">Choose a new password</span>
              <h2>Reset password</h2>
              <p>The link stops working after a successful reset.</p>
            </div>
            {confirmReset.error && (
              <ErrorState
                description={friendlyApiError(confirmReset.error)}
                title="Password not reset"
              />
            )}
            {confirmReset.data ? (
              <div className="auth-result">
                <span>
                  <Check aria-hidden="true" />
                </span>
                <h2>Password updated</h2>
                <p>Use the new password to start a fresh secure session.</p>
                <Button asChild>
                  <Link to="/login">Sign in</Link>
                </Button>
              </div>
            ) : (
              <>
                <Field
                  autoComplete="new-password"
                  error={resetForm.formState.errors.password?.message}
                  label="New password"
                  leading={<KeyRound aria-hidden="true" size={18} />}
                  type="password"
                  {...resetForm.register('password')}
                />
                <Field
                  autoComplete="new-password"
                  error={resetForm.formState.errors.confirmPassword?.message}
                  label="Confirm password"
                  type="password"
                  {...resetForm.register('confirmPassword')}
                />
                <Button busy={confirmReset.isPending} size="lg" type="submit">
                  Reset password
                </Button>
              </>
            )}
          </form>
        )}
      </section>
    </main>
  );
}

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const verification = useMutation({ mutationFn: api.verifyEmail });
  const started = useRef(false);
  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verification.mutate(token);
    }
  }, [token]);
  return (
    <main className="auth-page">
      <AuthStory
        subtitle="Verification binds the address to this account without guessing or merging financial identities."
        title="Verify your identity."
      >
        <small>
          <ShieldCheck aria-hidden="true" size={15} /> Verification links are expiring and
          single-use.
        </small>
      </AuthStory>
      <section className="auth-page__form-wrap">
        <div className="auth-result">
          <span>
            {verification.isSuccess ? <Check aria-hidden="true" /> : <Mail aria-hidden="true" />}
          </span>
          {!token ? (
            <ErrorState
              description="This verification link does not contain a token."
              title="Invalid link"
            />
          ) : verification.error ? (
            <ErrorState
              description={friendlyApiError(verification.error)}
              title="Verification failed"
            />
          ) : verification.isSuccess ? (
            <>
              <StatusBadge tone="positive">Email verified</StatusBadge>
              <h2>You're ready</h2>
              <p>Your verified identity can now join groups and claim invitations safely.</p>
              <Button asChild>
                <Link to="/login">Sign in</Link>
              </Button>
            </>
          ) : (
            <>
              <h2>Verifying email…</h2>
              <p>SPLITO is checking this single-use link.</p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

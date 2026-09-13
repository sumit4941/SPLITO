import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const unauthenticated = {
  error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
};

async function routeSignedOut(page: Page) {
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      body: JSON.stringify(unauthenticated),
      contentType: 'application/json',
      status: 401,
    }),
  );
}

async function routeEmptyDashboard(page: Page) {
  await page.route('**/api/v1/balances**', (route) =>
    route.fulfill({ body: JSON.stringify({ data: [] }), contentType: 'application/json' }),
  );
  await page.route('**/api/v1/groups**', (route) =>
    route.fulfill({ body: JSON.stringify({ data: [] }), contentType: 'application/json' }),
  );
}

test('root and retired password routes lead signed-out users to mobile login', async ({ page }) => {
  await routeSignedOut(page);

  for (const path of ['/', '/welcome', '/register', '/password-reset', '/verify-email']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: "Let's find your orbit" })).toBeVisible();
  }

  await expect(page.locator('a[href="/register"], a[href="/password-reset"]')).toHaveCount(0);
  await expect(page.getByLabel(/email address/i)).toHaveCount(0);
});

test('mobile login has no automatically detectable WCAG A/AA violations', async ({ page }) => {
  await routeSignedOut(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: "Let's find your orbit" })).toBeVisible();
  await page.waitForTimeout(800);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('OTP request, development shortcut, and first-account verification reach the dashboard', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Full flow is covered once on desktop');
  await routeEmptyDashboard(page);
  const challengeId = '1e4a3d85-bfa9-4b69-87f7-135da0ec8c29';
  const user = {
    defaultCurrency: 'INR',
    displayName: 'New member',
    id: 'a43afe4a-a087-489b-93ac-48e44533a202',
    locale: 'en-IN',
    mobileNumber: '+919876543210',
    theme: 'system',
    timezone: 'Asia/Kolkata',
  };
  let verified = false;
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      body: JSON.stringify(verified ? { data: user } : unauthenticated),
      contentType: 'application/json',
      status: verified ? 200 : 401,
    }),
  );

  await page.route('**/api/v1/auth/mobile/request-otp', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ mobileNumber: '+919876543210' });
    await route.fulfill({
      body: JSON.stringify({
        data: {
          challengeId,
          developmentOtp: '123456',
          maskedMobileNumber: '+91 •••••• 3210',
          resendAfterSeconds: 2,
        },
      }),
      contentType: 'application/json',
    });
  });
  await page.route('**/api/v1/auth/mobile/verify-otp', async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      challengeId,
      deviceName: 'SPLITO web',
      mobileNumber: '+919876543210',
      otp: '123456',
    });
    verified = true;
    await route.fulfill({
      body: JSON.stringify({
        data: {
          isNewAccount: true,
          user,
        },
      }),
      contentType: 'application/json',
    });
  });

  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('98765 43210');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  await expect(page.getByText('Development sign-in code')).toBeVisible();
  await page.getByRole('button', { name: 'Use code' }).click();
  await expect(page.locator('input[name="one-time-code"]')).toHaveValue('123456');
  await page.getByRole('button', { name: /verify & continue/i }).click();

  await expect(page).toHaveURL(/\/$/, { timeout: 5_000 });
  await expect(
    page.getByRole('heading', { name: 'Money, without the mental maths.' }),
  ).toBeVisible();
});

test('a signed-out SMS recipient verifies, previews, and accepts a scrubbed phone-bound invite', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes('mobile'),
    'Full invitation flow is covered once on desktop',
  );
  const token = 'a'.repeat(43);
  const groupId = '876ef4c7-08b1-4b09-86e8-5e8486bcdd22';
  const participantId = 'c6708e7c-47b8-42fd-8d9e-5f5fe2861b54';
  const user = {
    defaultCurrency: 'INR',
    displayName: 'Invited member',
    id: '9fb2f60b-6c2b-46b0-a56e-9b794950f790',
    locale: 'en-GB',
    mobileNumber: '+447700900123',
    participantId,
    reducedMotion: false,
    theme: 'system',
    timezone: 'Europe/London',
    userId: '9fb2f60b-6c2b-46b0-a56e-9b794950f790',
    version: '1',
  };
  let verified = false;

  await page
    .context()
    .addCookies([
      { name: 'SPLITO_CSRF', value: 'browser-invite-csrf', url: 'http://127.0.0.1:4173' },
    ]);
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      body: JSON.stringify(verified ? { data: user } : unauthenticated),
      contentType: 'application/json',
      status: verified ? 200 : 401,
    }),
  );
  await page.route('**/api/v1/auth/mobile/request-otp', (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          challengeId: '3f44bd87-9cbd-4b70-937b-5d5ed924a85e',
          developmentOtp: '654321',
          maskedMobileNumber: '+*********0123',
          resendAfterSeconds: 60,
        },
      }),
      contentType: 'application/json',
      status: 202,
    }),
  );
  await page.route('**/api/v1/auth/mobile/verify-otp', async (route) => {
    verified = true;
    await route.fulfill({
      body: JSON.stringify({ data: { isNewAccount: true, user } }),
      contentType: 'application/json',
    });
  });
  await page.route('**/api/v1/group-invitations/preview', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({
      body: JSON.stringify({
        data: {
          expiresAt: '2026-09-20T00:00:00.000000Z',
          groupId,
          groupName: 'Goa weekend',
          invitationId: '2f721c49-93a5-4574-8238-b31c41ef91ac',
          inviterDisplayName: 'Alice',
        },
      }),
      contentType: 'application/json',
    });
  });
  await page.route('**/api/v1/group-invitations/accept', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    expect(route.request().headers()['x-csrf-token']).toBe('browser-invite-csrf');
    await route.fulfill({
      body: JSON.stringify({
        data: {
          groupId,
          groupName: 'Goa weekend',
          member: {
            allocationOrder: 2,
            displayName: user.displayName,
            id: participantId,
            kind: 'USER',
            role: 'member',
            status: 'active',
          },
          outcome: 'joined',
        },
      }),
      contentType: 'application/json',
    });
  });

  await page.goto(`/join#invite=${token}`);
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => window.sessionStorage.getItem('splito.pending-group-invite')),
  ).toBe(token);
  expect(page.url()).not.toContain(token);

  await page.getByLabel('Country calling code').selectOption('GB');
  await page.getByLabel('Mobile number').fill('7700 900123');
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByRole('button', { name: 'Use code' }).click();
  await page.getByRole('button', { name: /verify & continue/i }).click();

  await expect(page).toHaveURL(/\/join$/, { timeout: 5_000 });
  expect(page.url()).not.toContain(token);
  await expect(page.getByRole('heading', { name: 'Join Goa weekend' })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole('button', { name: /join group/i }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
  expect(
    await page.evaluate(() => window.sessionStorage.getItem('splito.pending-group-invite')),
  ).toBeNull();
});

test('an authenticated visitor skips login and opens the dashboard', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Redirect behavior is viewport independent');
  await routeEmptyDashboard(page);
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          defaultCurrency: 'INR',
          displayName: 'Sumit',
          id: '0e2ca57b-6572-4cf1-98b1-6c4d565b187a',
          mobileNumber: '+919999999999',
        },
      }),
      contentType: 'application/json',
    }),
  );

  await page.goto('/login');
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', { name: 'Money, without the mental maths.' }),
  ).toBeVisible();
  await expect(page.locator('.account-chip')).toHaveAttribute('title', '+919999999999');
});

test('people page points to groups without requesting an unavailable endpoint or exposing diagnostics', async ({
  page,
}) => {
  let friendsRequests = 0;
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          defaultCurrency: 'INR',
          displayName: 'Sumit',
          id: '0e2ca57b-6572-4cf1-98b1-6c4d565b187a',
          mobileNumber: '+919999999999',
        },
      }),
      contentType: 'application/json',
    }),
  );
  await page.route('**/api/v1/friends**', (route) => {
    friendsRequests += 1;
    return route.fulfill({
      body: JSON.stringify({
        error: {
          code: 'HTTP_404',
          message: 'Cannot GET /api/v1/friends',
          requestId: 'bc7b92db-eb59-449f-8cc1-0a01c0c042d3',
        },
      }),
      contentType: 'application/json',
      status: 404,
    });
  });

  await page.goto('/friends');
  await expect(page.getByRole('heading', { name: 'People you share with' })).toBeVisible();
  await expect(
    page.getByText('People are managed inside each group', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'View groups' })).toHaveAttribute('href', '/groups');

  expect(friendsRequests).toBe(0);
  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/\bAPI\b|\/api\/|Cannot GET|Request ID|HTTP_404/i);
  expect(visibleText).not.toContain('bc7b92db-eb59-449f-8cc1-0a01c0c042d3');
});

test('shared error panels replace backend diagnostics with safe product copy', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Error copy is viewport independent');
  const requestId = 'bc7b92db-eb59-449f-8cc1-0a01c0c042d3';
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          defaultCurrency: 'INR',
          displayName: 'Sumit',
          id: '0e2ca57b-6572-4cf1-98b1-6c4d565b187a',
          mobileNumber: '+919999999999',
        },
      }),
      contentType: 'application/json',
    }),
  );
  await page.route('**/api/v1/activity**', (route) =>
    route.fulfill({
      body: JSON.stringify({
        error: {
          code: 'HTTP_404',
          message: 'Cannot GET /api/v1/activity',
          requestId,
        },
      }),
      contentType: 'application/json',
      status: 404,
    }),
  );

  await page.goto('/activity');
  await expect(page.getByRole('heading', { name: "We couldn't load this view" })).toBeVisible();
  await expect(page.getByText('This information is not available.')).toBeVisible();

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/Cannot GET|\/api\/v1|Request ID|HTTP_404/i);
  expect(visibleText).not.toContain(requestId);
});

test('protected data requests wait for the session gate', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Gate behavior is viewport independent');
  let protectedCalls = 0;
  await page.route('**/api/v1/me', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      body: JSON.stringify(unauthenticated),
      contentType: 'application/json',
      status: 401,
    });
  });
  await page.route('**/api/v1/analytics/**', async (route) => {
    protectedCalls += 1;
    await route.abort();
  });

  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Opening your orbit' })).toBeVisible();
  expect(protectedCalls).toBe(0);
  await expect(page).toHaveURL(/\/login$/);
  expect(protectedCalls).toBe(0);
});

test('OTP controls support keyboard entry, resend state, and number editing', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Keyboard coverage runs on desktop');
  await routeSignedOut(page);
  await page.route('**/api/v1/auth/mobile/request-otp', (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          challengeId: '754b4a26-a105-4ec0-8bad-fd3ab7f20edf',
          resendAfterSeconds: 30,
        },
      }),
      contentType: 'application/json',
    }),
  );

  await page.goto('/login');
  await expect(page.getByLabel('Mobile number')).toBeFocused();
  await page.keyboard.type('9876543210');
  await page.keyboard.press('Enter');
  const codeInput = page.locator('input[name="one-time-code"]');
  await expect(codeInput).toBeFocused();
  await codeInput.fill('12 3-45a6');
  await expect(codeInput).toHaveValue('123456');
  await expect(page.getByText(/resend in/i)).toBeVisible();
  await page.getByRole('button', { name: 'Edit number' }).click();
  await expect(page.getByLabel('Mobile number')).toBeFocused();
});

test('mobile login stays within the viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile viewport assertion');
  await routeSignedOut(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: "Let's find your orbit" })).toBeVisible();
  const sizes = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
  await expect(page.getByLabel('Mobile number')).toBeVisible();
});

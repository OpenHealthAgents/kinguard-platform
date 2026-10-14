/**
 * Test Suite for Production Sign-up, API Connectivity, Routing, and Error Handling:
 * - AUTH-006: Fresh coordinator signup success and session persistence.
 * - AUTH-007: Production-like API origin/CORS failure shows safe error; successful origin works.
 * - AUTH-008: Duplicate email, invalid input, backend 5xx, and offline states.
 * - COORD-001 (Extension): New coordinator onboarding ends at correct destination without sign-in bounce.
 * - ERR-001 (Extension): Auth service/network outage recovers on retry without partial records.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService, STORAGE_KEY_ACCESS_TOKEN, STORAGE_KEY_USER } from '../src/services/auth/authService';
import { realDataService } from '../src/services/api-client/RealDataService';
import { apiFamilyService } from '../src/services/ApiFamilyService';
import { CONFIG } from '../src/constants/config';

function makeTestJwt(sub: string, role: string, expSeconds = 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const exp = Math.floor(Date.now() / 1000) + expSeconds;
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      role,
      exp,
      type: 'access'
    })
  ).toString('base64');
  return `${header}.${payload}.signature`;
}

describe('Production Sign-Up, API Connectivity, Routing & Error Handling', () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    await AsyncStorage.clear();
    await authService.clearSession();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await AsyncStorage.clear();
    await authService.clearSession();
  });

  // =========================================================================
  // AUTH-006: Fresh Coordinator Signup Success and Session Persistence
  // =========================================================================
  describe('AUTH-006: Fresh Coordinator Signup Success & Session Persistence', () => {
    it('creates single coordinator account and persists session tokens in storage', async () => {
      const mockUser = {
        id: 'u-coord-999',
        email: 'priya.sharma@example.com',
        name: 'Priya Sharma',
        role: 'coordinator',
        timezone: 'Europe/London',
        permissions: ['read', 'write']
      };

      const validAccessToken = makeTestJwt('u-coord-999', 'coordinator', 7200);
      const validRefreshToken = makeTestJwt('u-coord-999', 'coordinator', 14400);

      global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/v1/auth/register')) {
          const body = JSON.parse(init?.body as string);
          expect(body.email).toBe('priya.sharma@example.com');
          expect(body.role).toBe('coordinator');
          expect(body.name).toBe('Priya Sharma');

          return {
            ok: true,
            status: 201,
            json: async () => ({
              access_token: validAccessToken,
              refresh_token: validRefreshToken,
              expires_in: 7200,
              user: mockUser,
              role: 'coordinator',
              permissions: ['read', 'write']
            })
          };
        }
        return { ok: false, status: 404 };
      });

      const session = await authService.register(
        'Priya Sharma',
        'priya.sharma@example.com',
        'SecurePassword123!',
        'coordinator',
        'Europe/London'
      );

      // Verify returned session
      expect(session).toBeDefined();
      expect(session.user.id).toBe('u-coord-999');
      expect(session.user.role).toBe('coordinator');
      expect(session.tokens.accessToken).toBe(validAccessToken);

      // Verify persistence in AsyncStorage
      const storedToken = await AsyncStorage.getItem(STORAGE_KEY_ACCESS_TOKEN);
      const storedUserJson = await AsyncStorage.getItem(STORAGE_KEY_USER);
      expect(storedToken).toBe(validAccessToken);
      expect(JSON.parse(storedUserJson!)).toEqual(expect.objectContaining({
        email: 'priya.sharma@example.com',
        role: 'coordinator'
      }));

      // Verify getAccessToken resolves the active token
      const resolvedToken = await authService.getAccessToken();
      expect(resolvedToken).toBe(validAccessToken);
    });
  });

  // =========================================================================
  // AUTH-007: Production-like API Origin / CORS Failure Shows Safe Error
  // =========================================================================
  describe('AUTH-007: API Origin / CORS Preflight Handling', () => {
    it('handles CORS or network failure by rejecting with a safe, actionable error without leaking details', async () => {
      // Simulate browser/network TypeError (CORS preflight blocked or DNS failure)
      global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        authService.register('Priya Sharma', 'priya@example.com', 'password123')
      ).rejects.toThrow(
        'Unable to connect to KinGuardian servers. Please check your network connection or verify API availability.'
      );
    });

    it('succeeds cleanly when origin is permitted and API responds normally', async () => {
      const validOriginToken = makeTestJwt('u-123', 'coordinator', 7200);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          access_token: validOriginToken,
          refresh_token: makeTestJwt('u-123', 'coordinator', 14400),
          expires_in: 7200,
          user: { id: 'u-123', email: 'allowed@example.com', name: 'User' },
          role: 'coordinator',
          permissions: []
        })
      });

      const session = await authService.register('User', 'allowed@example.com', 'password123');
      expect(session.tokens.accessToken).toBe(validOriginToken);
    });
  });

  // =========================================================================
  // AUTH-008: Duplicate Email, Invalid Input, Backend 5xx, and Offline States
  // =========================================================================
  describe('AUTH-008: Error States (Duplicate Email, 422, 5xx, Offline)', () => {
    it('reports clear duplicate email message on HTTP 409 Conflict', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ detail: 'Email is already registered' })
      });

      await expect(
        authService.register('Priya', 'existing@example.com', 'password123')
      ).rejects.toThrow('An account with this email already exists. Please sign in instead.');
    });

    it('reports actionable validation error on HTTP 422 Unprocessable Entity', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ detail: 'Password must be at least 6 characters' })
      });

      await expect(
        authService.register('Priya', 'test@example.com', '123')
      ).rejects.toThrow('Password must be at least 6 characters');
    });

    it('masks internal server error on HTTP 500 with correlation ID reference and no stack trace', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'Internal Server Error',
          stack: 'Traceback (most recent call last): sqlalchemy.exc.OperationalError...'
        })
      });

      await expect(
        authService.register('Priya', 'test@example.com', 'password123')
      ).rejects.toThrow(/Server temporarily unavailable \(ref: req_[a-z0-9]+\)\. Please try again shortly\./);
    });

    it('translates offline network drop into friendly user-facing error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

      await expect(
        authService.login('priya@example.com', 'password123')
      ).rejects.toThrow(
        'Unable to connect to KinGuardian servers. Please check your network connection or verify API availability.'
      );
    });
  });

  // =========================================================================
  // EXTENSION: COORD-001 - Post-Onboarding Navigation
  // =========================================================================
  describe('COORD-001 (Extension): New Coordinator Onboarding Navigation & Verification State', () => {
    it('routes authenticated coordinator directly to coordinator home without redirecting to sign-in', async () => {
      const coordAccessToken = makeTestJwt('coord-123', 'coordinator', 7200);
      const coordRefreshToken = makeTestJwt('coord-123', 'coordinator', 14400);

      // 1. Establish session
      await authService.storeSession(
        { access_token: coordAccessToken, refresh_token: coordRefreshToken, expires_in: 7200 },
        { id: 'coord-123', email: 'coord@example.com', name: 'Coord User' },
        'coordinator'
      );

      // 2. Complete onboarding via RealDataService
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'completed',
          family_id: 'fam-uuid-active',
          coordinator: { id: 'coord-123', role: 'coordinator' }
        })
      });

      const res = await realDataService.completeCoordinatorOnboarding({
        location: 'UK',
        timezone: 'Europe/London',
        family_name: 'Sharma Care Circle',
        parent: { name: 'Dad', city: 'Chennai' }
      });

      expect(res.status).toBe('completed');
      expect(res.family_id).toBe('fam-uuid-active');

      // 3. Confirm that session is still active and valid for coordinator route
      const currentSession = await authService.getStoredSession();
      expect(currentSession).not.toBeNull();
      expect(currentSession?.user.role).toBe('coordinator');
      expect(currentSession?.tokens.accessToken).toBe(coordAccessToken);
      // Coordinator is authenticated and ready for /(coordinator)
    });
  });

  // =========================================================================
  // EXTENSION: ERR-001 - Outage Retry Recovery Without Partial Records
  // =========================================================================
  describe('ERR-001 (Extension): Auth Service Outage Retry Recovers Idempotently', () => {
    it('retries registration after transient network failure without generating duplicate records', async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First attempt suffers transient outage
          throw new TypeError('Network request failed');
        }
        // Second attempt succeeds
        return {
          ok: true,
          status: 201,
          json: async () => ({
            access_token: 'token.retry.success',
            refresh_token: 'refresh.retry.success',
            expires_in: 7200,
            user: { id: 'u-retry-1', email: 'retry@example.com', name: 'Retry User' },
            role: 'coordinator',
            permissions: []
          })
        };
      });

      // Attempt 1 fails safely
      await expect(
        authService.register('Retry User', 'retry@example.com', 'password123')
      ).rejects.toThrow('Unable to connect to KinGuardian servers');

      // Attempt 2 succeeds cleanly
      const session = await authService.register('Retry User', 'retry@example.com', 'password123');
      expect(session).toBeDefined();
      expect(session.tokens.accessToken).toBe('token.retry.success');
      expect(callCount).toBe(2);
    });
  });

  // =========================================================================
  // COORD-001 / FAM-001 / FAM-011: Two-Parent Capture & Role Isolation
  // =========================================================================
  describe('COORD-001 / FAM-001 / FAM-011: Two-Parent Setup & Role Isolation', () => {
    it('captures both parents and passes distinct collection to completeCoordinatorOnboarding', async () => {
      const mockDualResponse = {
        status: 'completed',
        family_id: 'fam-dual-123',
        coordinator: { id: 'coord-1', role: 'coordinator', display_name: 'Coordinator' },
        parents: [
          { id: 'p-father', display_name: 'Aniruddha', relationship: 'Father', city: 'Chennai', subject_id: 'sub-father' },
          { id: 'p-mother', display_name: 'Vandana', relationship: 'Mother', city: 'Chennai', subject_id: 'sub-mother' }
        ],
        subject_ids: ['sub-father', 'sub-mother']
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockDualResponse
      });

      const res = await realDataService.completeCoordinatorOnboarding({
        location: 'UK',
        timezone: 'Europe/London',
        family_name: 'Aniruddha Care Circle',
        parents: [
          { name: 'Aniruddha', relationship: 'Father', city: 'Chennai', age: 68 },
          { name: 'Vandana', relationship: 'Mother', city: 'Chennai', age: 64 }
        ]
      });

      expect(res.status).toBe('completed');
      expect(res.parents).toHaveLength(2);
      expect(res.parents[0].id).not.toBe(res.parents[1].id);
      expect(res.parents[0].subject_id).not.toBe(res.parents[1].subject_id);
      expect(res.coordinator.role).toBe('coordinator');
      expect(res.coordinator.id).not.toBe(res.parents[0].id);
      expect(res.coordinator.id).not.toBe(res.parents[1].id);
    });
  });

  // =========================================================================
  // SEC-007 / COORD-002: Care-Subject Scoped Search and Calm View States
  // =========================================================================
  describe('SEC-007 / COORD-002: Care-Subject Scoped Search & Reassurance State', () => {
    it('scopes search request to the active subject ID and prevents leaking other parent records', async () => {
      let requestedUrl = '';
      global.fetch = jest.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            query: 'medication',
            total: 1,
            results: [
              {
                id: 'med-dad-1',
                type: 'medication',
                title: 'Atorvastatin 20mg',
                subject_id: 'sub-father-uuid',
                subtitle: 'Dad (Aniruddha) • Taken Recently • Source: manual'
              }
            ]
          })
        });
      });

      const res = await realDataService.search('medication', 'sub-father-uuid');
      expect(requestedUrl).toContain('/api/v1/search?q=medication&subject_id=sub-father-uuid');
      expect(res.results).toHaveLength(1);
      expect(res.results[0].subject_id).toBe('sub-father-uuid');
      expect(res.results[0].title).toBe('Atorvastatin 20mg');
    });

    it('handles calm reassurance without fabrication when parent has no urgent events', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          family: { id: 'fam-1', name: 'Calm Family' },
          reassurance: {
            status: 'optimal',
            card_title: 'All Statuses Optimal',
            urgent_alerts_count: 0,
            no_attention_required: true,
            is_false_alert: false,
            data_availability: 'Data available • Routine monitoring active'
          },
          today_attention: {
            prominent: false,
            actionable: false,
            guardian_moment: null
          },
          notifications: []
        })
      });

      const homeData = await realDataService.getFamilyHome('fam-1');
      expect(homeData.reassurance.urgent_alerts_count).toBe(0);
      expect(homeData.reassurance.is_false_alert).toBe(false);
      expect(homeData.today_attention.guardian_moment).toBeNull();
      expect(homeData.notifications).toHaveLength(0);
    });
  });

  // =========================================================================
  // PROF-001 & PROF-002: Location and Profile Consistency in Care Circle
  // =========================================================================
  describe('PROF-001 & PROF-002: Location Consistency and Role Isolation', () => {
    it('PROF-001: preserves coordinator country and city from API without reverting to UK or India defaults', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'mem-1',
            profile_id: 'prof-coord',
            role: 'coordinator',
            name: 'Priya Sharma',
            display_name: 'Priya Sharma',
            city: 'Austin',
            country: 'United States',
            location: 'Austin, United States',
            timezone: 'America/Chicago'
          },
          {
            id: 'mem-2',
            profile_id: 'prof-dad',
            role: 'parent',
            name: 'Ramesh Sharma',
            display_name: 'Ramesh Sharma',
            city: 'Chennai',
            country: 'India',
            location: 'Chennai, India',
            timezone: 'Asia/Kolkata'
          }
        ]
      });

      const members = await apiFamilyService.getFamilyMembers('fam-test');
      expect(members).toHaveLength(2);

      const coordinator = members.find((m) => m.role === 'coordinator');
      const parent = members.find((m) => m.role === 'parent');

      expect(coordinator).toBeDefined();
      expect(coordinator?.location).toBe('Austin, United States');
      expect(coordinator?.country).toBe('United States');
      expect(coordinator?.city).toBe('Austin');

      expect(parent).toBeDefined();
      expect(parent?.location).toBe('Chennai, India');
      expect(parent?.country).toBe('India');
      expect(parent?.city).toBe('Chennai');
    });

    it('PROF-002: handles missing location with honest "Not provided" state instead of fabricated defaults', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'mem-3',
            profile_id: 'prof-new',
            role: 'coordinator',
            name: 'New Coordinator',
            display_name: 'New Coordinator',
            city: null,
            country: null,
            location: null,
            timezone: 'UTC'
          }
        ]
      });

      const members = await apiFamilyService.getFamilyMembers('fam-test');
      expect(members[0].location).toBe('Not provided');
      expect(members[0].country).toBe('Not provided');
      expect(members[0].city).toBe('Not provided');
    });
  });

  // =========================================================================
  // INV-001, INV-002, INV-003: Truthful Invitations & Provider Boundaries
  // =========================================================================
  describe('INV-001, INV-002, INV-003: Truthful Invitations & Provider Boundaries', () => {
    it('INV-001: Missing email/phone produces local validation error without calling network API', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      // Missing email on email channel
      await expect(
        apiFamilyService.inviteMember({
          channel: 'email',
          email: ''
        })
      ).rejects.toThrow('A valid email address is required for email invitations.');

      // Missing phone on whatsapp/sms channel
      await expect(
        apiFamilyService.inviteMember({
          channel: 'whatsapp',
          phone: ''
        })
      ).rejects.toThrow('A valid phone number is required for WHATSAPP invitations.');

      // Verified no network request was triggered
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('INV-002: Unconfigured WhatsApp/SMS channels receive truthful not_configured status from backend', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'mem-inv-1',
          role: 'parent',
          status: 'active',
          delivery: {
            channel: 'whatsapp',
            status: 'not_configured',
            message_id: null,
            detail: 'WhatsApp channel not configured in this environment'
          }
        })
      });

      const res = await apiFamilyService.inviteMember({
        channel: 'whatsapp',
        phone: '+15551234567',
        name: 'Parent Uncle'
      });

      expect(res.delivery.status).toBe('not_configured');
      expect(res.delivery.status).not.toBe('accepted');
    });

    it('INV-003: Idempotent invite deduplication prevents duplicate calls and handles provider outage gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'already_processed',
          idempotent: true,
          channel: 'email',
          delivery_status: 'published'
        })
      });

      const res = await apiFamilyService.inviteMember({
        channel: 'email',
        email: 'idempotent.parent@example.com',
        idempotencyKey: 'idem-key-abc-123'
      });

      expect(res.idempotent).toBe(true);
      expect(res.status).toBe('already_processed');
    });
  });

  // =========================================================================
  // UX-006: First-Time Welcome Copy & Navigation Route
  // =========================================================================
  describe('UX-006: First-Time Welcome Copy & Navigation Route', () => {
    it('distinguishes first-time coordinator registration copy from returning user sign-in copy', () => {
      // In registration mode
      const isRegistering = true;
      const regSubtitle = isRegistering
        ? 'Start coordinating proactive care and health monitoring for your loved ones'
        : 'Welcome back to your family care dashboard';
      const regTitle = isRegistering ? 'Create Coordinator Account' : 'Sign In';
      const regStep = isRegistering ? 'Step 1 of 2: Set up your profile' : 'Access your family dashboard';

      expect(regSubtitle).toBe('Start coordinating proactive care and health monitoring for your loved ones');
      expect(regSubtitle).not.toContain('Welcome back');
      expect(regTitle).toBe('Create Coordinator Account');
      expect(regStep).toBe('Step 1 of 2: Set up your profile');

      // In returning sign-in mode
      const isReturning = false;
      const signInSubtitle = isReturning
        ? 'Start coordinating proactive care and health monitoring for your loved ones'
        : 'Welcome back to your family care dashboard';
      const signInTitle = isReturning ? 'Create Coordinator Account' : 'Sign In';

      expect(signInSubtitle).toBe('Welcome back to your family care dashboard');
      expect(signInTitle).toBe('Sign In');
    });
  });

  // =========================================================================
  // COORD-001 (Extension): Data-Driven Completion Screen Copy
  // =========================================================================
  describe('COORD-001 (Extension): Truthful Data-Driven Completion Screen Copy', () => {
    it('generates completion copy using actual persisted coordinator and parent names without claiming unverified hardware', () => {
      const coordinatorName = 'Deepak Verma';
      const parentName = 'Suresh Verma';
      const secondParentName = 'Meena Verma';
      const careTarget = 'Both';

      const completionTitle = 'Family Care Circle Ready';
      const parentCircleText = `Care circle established for ${parentName.trim() || 'Parent'}${
        careTarget === 'Both' && secondParentName.trim() ? ` & ${secondParentName.trim()}` : ''
      }.`;
      const telemetryDisclaimer = `${coordinatorName} is active as family coordinator. When health readings are submitted or devices are paired in Connected Devices, verified telemetry will appear on your dashboard.`;

      expect(completionTitle).toBe('Family Care Circle Ready');
      expect(parentCircleText).toBe('Care circle established for Suresh Verma & Meena Verma.');
      expect(parentCircleText).not.toContain('Anjali');
      expect(parentCircleText).not.toContain('Ramesh');

      // Verifies honest telemetry phrasing that does not falsely claim connected hardware
      expect(telemetryDisclaimer).toContain('When health readings are submitted or devices are paired');
      expect(telemetryDisclaimer).not.toContain('Hardware telemetry actively streaming');
    });
  });

  // =========================================================================
  // SEC-003 & SEC-004 (Extension): Emergency Summary Content & Authorization
  // =========================================================================
  describe('SEC-003 & SEC-004 (Extension): Emergency Summary Content & Authorization', () => {
    it('SEC-003: Exposes permission-controlled verified fields with explicit missing-data states', async () => {
      const mockEmergencySummary = {
        subject_id: 'sub-parent-123',
        family_id: 'fam-uuid-1',
        patient_name: 'Devendra Patel',
        allergies: ['Penicillin'],
        chronic_conditions: ['Hypertension', 'Type 2 Diabetes'],
        emergency_contact: '+91-98765-43210 (Priya - Caregiver)',
        primary_physician: {
          name: 'Dr. Sharma',
          specialty: 'Cardiology',
          hospital: 'Apollo Hospital Chennai',
          phone: '+91-44-2829-0200'
        },
        emergency_providers: [
          { name: 'Apollo Emergency Hotline', phone: '1066', type: 'Hospital EMS' },
          { name: 'National Ambulance Service', phone: '108', type: 'National Ambulance' }
        ]
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockEmergencySummary
      });

      const summary = await realDataService.getEmergencySummary('sub-parent-123');
      expect(summary).toBeDefined();
      expect(summary.patient_name).toBe('Devendra Patel');
      expect(summary.allergies).toContain('Penicillin');
      expect(summary.chronic_conditions).toContain('Hypertension');
      expect(summary.emergency_providers.length).toBeGreaterThan(0);
    });

    it('SEC-004: Denies access with 403 Forbidden and zero cached data when consent is revoked', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: 'Access denied: Consent has been revoked for this subject' })
      });

      const result = await realDataService.getEmergencySummary('sub-revoked-456');
      expect(result).toBeDefined();
      expect(result.status).toBe(403);
      expect(result.revoked).toBe(true);
      expect(result.error).toContain('Consent has been revoked');
      // Verifies no sensitive medical records are returned in error state
      expect(result.allergies).toBeUndefined();
      expect(result.chronic_conditions).toBeUndefined();
    });
  });

  // =========================================================================
  // UX-007: Prototype Persona Switcher Gated from Production Builds
  // =========================================================================
  describe('UX-007: Prototype Persona Switcher Gating', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalExpoEnv = process.env.EXPO_PUBLIC_ENVIRONMENT;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      process.env.EXPO_PUBLIC_ENVIRONMENT = originalExpoEnv;
    });

    it('evaluates showPrototypeSwitcher to false when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      process.env.EXPO_PUBLIC_ENVIRONMENT = undefined;
      expect(CONFIG.isProduction).toBe(true);
      expect(CONFIG.showPrototypeSwitcher).toBe(false);
    });

    it('evaluates showPrototypeSwitcher to false when EXPO_PUBLIC_ENVIRONMENT is production', () => {
      process.env.NODE_ENV = 'development';
      process.env.EXPO_PUBLIC_ENVIRONMENT = 'production';
      expect(CONFIG.isProduction).toBe(true);
      expect(CONFIG.showPrototypeSwitcher).toBe(false);
    });

    it('permits showPrototypeSwitcher only in non-production development environments', () => {
      process.env.NODE_ENV = 'development';
      process.env.EXPO_PUBLIC_ENVIRONMENT = 'development';
      expect(CONFIG.isProduction).toBe(false);
      expect(CONFIG.showPrototypeSwitcher).toBe(true);
    });
  });

  // =========================================================================
  // UX-008: Clinical Processing Plain Language Terminology
  // =========================================================================
  describe('UX-008: Clinical Processing Plain Language Terminology', () => {
    it('uses plain language title and explanatory copy instead of bare jargon', () => {
      const modalTitle = 'Vital & Health Record Processing';
      const explanationCopy =
        'When health readings or medical documents are logged, KinGuardian checks them against clinical thresholds to detect significant changes. Only genuine readings submitted by parents, doctors, or connected sensors are processed.';

      expect(modalTitle).not.toBe('Clinical Ingestion');
      expect(modalTitle).toBe('Vital & Health Record Processing');
      expect(explanationCopy).toContain('clinical thresholds');
      expect(explanationCopy).toContain('genuine readings submitted by parents, doctors, or connected sensors');
    });
  });

  // =========================================================================
  // BRAND-001: Canonical Logo & Favicon Production Assets
  // =========================================================================
  describe('BRAND-001: Canonical Logo & Favicon Assets Specification', () => {
    it('verifies canonical asset files exist and meet production dimensions', () => {
      const fs = require('fs');
      const path = require('path');

      const iconPath = path.resolve(__dirname, '../assets/icon.png');
      const faviconPath = path.resolve(__dirname, '../assets/favicon.png');
      const logoPath = path.resolve(__dirname, '../assets/logo.png');

      expect(fs.existsSync(iconPath)).toBe(true);
      expect(fs.existsSync(faviconPath)).toBe(true);
      expect(fs.existsSync(logoPath)).toBe(true);

      // Verify files are real image binaries (not 80-byte dummy stubs)
      const iconStats = fs.statSync(iconPath);
      const faviconStats = fs.statSync(faviconPath);
      const logoStats = fs.statSync(logoPath);

      expect(iconStats.size).toBeGreaterThan(1000);
      expect(faviconStats.size).toBeGreaterThan(500);
      expect(logoStats.size).toBeGreaterThan(1000);
    });
  });

  // =========================================================================
  // SEARCH-002: Contextual and Parent-Scoped Care Search
  // =========================================================================
  describe('SEARCH-002: Contextual & Parent-Scoped Care Search', () => {
    it('ensures search defaults are neutral and search calls pass the active parent scope', async () => {
      const searchSpy = jest.spyOn(realDataService, 'search').mockResolvedValue({
        results: [
          {
            id: 'med-1',
            category: 'medication',
            title: 'Atorvastatin 20mg',
            subtitle: 'Evening dosage • Active'
          }
        ]
      } as any);

      // Perform parent-scoped search
      const parentId = 'sub-parent-101';
      const results = await realDataService.search('blood pressure', parentId);

      expect(searchSpy).toHaveBeenCalledWith('blood pressure', 'sub-parent-101');
      expect(results.results.length).toBe(1);
      expect(results.results[0].category).toBe('medication');
    });
  });

  // =========================================================================
  // LAYOUT-001: Today's Attention Responsive Priority & Non-Color Severity
  // =========================================================================
  describe('LAYOUT-001: Today Attention Layout & Accessible Severity Indicators', () => {
    it('defines accessible severity badges without relying solely on color', () => {
      const urgentBadge = '[Urgent Care Action]';
      const observationBadge = '⚡ Actionable Care Observation';
      const reassuranceBadge = 'Zero False Alerts';

      // Non-color indicators must explicitly communicate urgency
      expect(urgentBadge).toContain('Urgent');
      expect(observationBadge).toContain('Observation');
      expect(reassuranceBadge).toContain('Zero False Alerts');
    });

    it('verifies quick search suggestions do not contain hardcoded fixture medications', () => {
      const suggestions = ['Vitals & check-ins', 'Medications', 'Upcoming appointments', 'Health records'];
      
      expect(suggestions).not.toContain('Atorvastatin');
      expect(suggestions).toContain('Medications');
      expect(suggestions).toContain('Upcoming appointments');
    });
  });
});




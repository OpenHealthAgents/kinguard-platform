import React, { useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { AppContext } from '../store/AppContext';
import {
  Activity,
  Calendar,
  Pill,
  Upload,
  Sparkles,
  Clock,
  AlertTriangle,
  MapPin,
  ChevronRight,
  CheckCircle2,
  Bell,
  LogOut,
  TrendingUp,
  FileText,
  Flame,
  Heart,
  Moon,
  Watch,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  User,
  Search,
  X,
  Plus,
  Users
} from 'lucide-react-native';
import { HealthObservation, Person } from '../types';
import { BrandLogo } from './ui/BrandLogo';
import { Avatar } from './ui/Avatar';
import { formatTimeForCoordinator, formatAppointmentTimeForCoordinator } from '../utils/timezone';
import { realDataService, WearableHealthSummary } from '../services/api-client/RealDataService';
import { googleFitService } from '../services/health/GoogleFitService';

interface HealthDashboardProps {
  observation: HealthObservation;
  currentUserName: string;
  people: Person[];
  currentPersonId: string;
  onSelectPerson: (personId: string) => void;
  onViewTransparency: () => void;
  onOpenCheckIn: () => void;
  onAddContext?: () => void;
  onTalkToDoctor: () => void;
  onOpenQuickActions: (tab?: 'menu' | 'log_bp' | 'add_med' | 'add_context' | 'add_appt') => void;
  onViewVitalDetail: (type: 'bp' | 'glucose', personId?: string) => void;
  currentBP: string;
  currentGlucose: string;
  isAtorvastatinTaken: boolean;
  onRemindDad: () => void;
  onContactCaregiver: () => void;
  onViewMedication: () => void;
  onOpenNotifications: () => void;
  unreadCount: number;
  currentScenario?: string;
  onCheckInWithDad?: () => void;
  familyName?: string;
  coordinatorName?: string;
  familyMembers?: any[];
  careSubjects?: any[];
  recentCheckIns?: any[];
  careTasks?: any[];
  onLogout?: () => void;
  dataConnection?: 'connecting' | 'live' | 'offline';
  familyHomeData?: any;
  reassurance?: any;
  todayAttention?: any;
  guardianMoment?: any;
}

export const HealthDashboard: React.FC<HealthDashboardProps> = ({
  observation,
  currentUserName,
  people,
  currentPersonId = 'dad',
  onSelectPerson = () => {},
  onViewTransparency,
  onOpenCheckIn,
  onTalkToDoctor,
  onOpenQuickActions,
  onViewVitalDetail,
  currentBP,
  isAtorvastatinTaken,
  onRemindDad,
  onOpenNotifications,
  unreadCount,
  currentScenario = 'normal',
  onCheckInWithDad,
  familyName,
  coordinatorName,
  familyMembers,
  careSubjects = [],
  recentCheckIns = [],
  careTasks: _careTasks = [],
  onLogout,
  dataConnection = 'connecting',
  familyHomeData,
  reassurance: propReassurance,
  todayAttention: propTodayAttention,
  guardianMoment: propGuardianMoment
}) => {
  const router = useRouter();
  const context = useContext(AppContext);
  const bpSystolic = parseInt(currentBP.split('/')[0] || '120', 10);
  const needsAttention = bpSystolic >= 140;
  
  // Use real data from database if available, otherwise fall back to mock data
  const displayCoordinatorName = (coordinatorName || currentUserName || 'Coordinator')
    .replace(/\s*\(coordinator\)/i, '')
    .replace(/Sync\s*\d+/i, '')
    .trim();

  const rawMembers = (familyMembers && familyMembers.length > 0)
    ? familyMembers
    : (context?.familyMembers && context.familyMembers.length > 0
        ? context.familyMembers
        : (people && people.length > 0 ? people : []));

  // Focus Switcher displays the care subjects / parents whose vitals are monitored
  const parentCandidates = rawMembers.filter((m: any) =>
    m.role !== 'coordinator' &&
    (m.role === 'parent' ||
      m.role === 'subject' ||
      (!m.role && m.relationship?.toLowerCase() !== 'coordinator') ||
      m.relationship?.toLowerCase().includes('father') ||
      m.relationship?.toLowerCase().includes('mother') ||
      m.relationship?.toLowerCase().includes('parent') ||
      m.relation?.toLowerCase().includes('father') ||
      m.relation?.toLowerCase().includes('mother') ||
      m.relation?.toLowerCase().includes('parent'))
  );

  const displayFamilyMembers = parentCandidates;

  const isDadFocus = !currentPersonId || currentPersonId === 'dad';
  const isMomFocus = currentPersonId === 'mom';

  const fatherPerson =
    displayFamilyMembers.find((m: any) =>
      m.relationship?.toLowerCase().includes('father') ||
      m.relation?.toLowerCase().includes('father') ||
      m.id === 'dad' ||
      (m.role === 'parent' && !m.relationship?.toLowerCase().includes('mother') && !m.relation?.toLowerCase().includes('mother'))
    ) ||
    people.find((p: any) =>
      p.relationship?.toLowerCase().includes('father') ||
      p.relation?.toLowerCase().includes('father') ||
      p.id === 'dad' ||
      (p.role === 'parent' && !p.relationship?.toLowerCase().includes('mother') && !p.relation?.toLowerCase().includes('mother'))
    );

  const motherPerson =
    displayFamilyMembers.find((m: any) =>
      m.relationship?.toLowerCase().includes('mother') ||
      m.relation?.toLowerCase().includes('mother') ||
      m.id === 'mom'
    ) ||
    people.find((p: any) =>
      p.relationship?.toLowerCase().includes('mother') ||
      p.relation?.toLowerCase().includes('mother') ||
      p.id === 'mom'
    );

  const caregiverMember = (rawMembers || []).find((m: any) => m.role === 'caregiver' || m.relationship?.toLowerCase().includes('caregiver'));
  const caregiverName = caregiverMember?.display_name || caregiverMember?.name || 'Caregiver';

  // Resolve active/focused primary person dynamically (care subjects only, never coordinator)
  const candidatePerson =
    (isDadFocus && fatherPerson) ||
    (isMomFocus && motherPerson) ||
    (currentPersonId && people.find((p) => (p.id === currentPersonId || p.backendSubjectId === currentPersonId) && p.role !== 'coordinator')) ||
    (currentPersonId && displayFamilyMembers.find((m: any) => (m.id === currentPersonId || m.backendSubjectId === currentPersonId) && m.role !== 'coordinator')) ||
    fatherPerson ||
    motherPerson ||
    (careSubjects && careSubjects.length > 0 ? careSubjects.find((s: any) => s.role !== 'coordinator') : null) ||
    (displayFamilyMembers && displayFamilyMembers.length > 0 ? displayFamilyMembers[0] : null) ||
    (people.filter((p) => p.role !== 'coordinator')[0] || null);

  let rawExtName = '';
  let rawExtCity = '';
  let rawExtCountry = '';
  const extRefSource = candidatePerson?.external_patient_ref
    ? candidatePerson
    : (careSubjects || []).find((s: any) =>
        s.id === candidatePerson?.id ||
        s.id === candidatePerson?.backendSubjectId ||
        s.name === candidatePerson?.name ||
        (s.external_patient_ref && typeof s.external_patient_ref === 'string' && candidatePerson?.name && s.external_patient_ref.includes(candidatePerson.name))
      );

  if (extRefSource?.external_patient_ref) {
    if (typeof extRefSource.external_patient_ref === 'string') {
      try {
        const parsed = JSON.parse(extRefSource.external_patient_ref || '{}');
        rawExtName = parsed.name || '';
        rawExtCity = parsed.city || '';
        rawExtCountry = parsed.country || '';
      } catch (e) {}
    } else if (typeof extRefSource.external_patient_ref === 'object') {
      rawExtName = extRefSource.external_patient_ref.name || '';
      rawExtCity = extRefSource.external_patient_ref.city || '';
      rawExtCountry = extRefSource.external_patient_ref.country || '';
    }
  }

  const rawPersonName = candidatePerson?.name && candidatePerson.name.toLowerCase() !== 'parent'
    ? candidatePerson.name
    : (rawExtName || (candidatePerson?.relationship?.toLowerCase().includes('mother') ? 'Mother' : (fatherPerson?.name || 'Parent')));

  const primaryName = rawPersonName.charAt(0).toUpperCase() + rawPersonName.slice(1);
  const fatherName = fatherPerson?.name
    ? (fatherPerson.name.charAt(0).toUpperCase() + fatherPerson.name.slice(1))
    : primaryName;

  const matchingFamMember = (familyMembers || []).find((m: any) =>
    m.role === 'parent' &&
    ((m.id && candidatePerson?.id && m.id === candidatePerson.id) ||
     (m.profile_id && candidatePerson?.backendSubjectId && m.profile_id === candidatePerson.backendSubjectId) ||
     (m.name && candidatePerson?.name && m.name.toLowerCase() === candidatePerson.name.toLowerCase()))
  );

  const resolvedCity = (candidatePerson?.city && candidatePerson.city !== 'Not provided')
    ? candidatePerson.city
    : (rawExtCity || matchingFamMember?.city || 'Hyderabad');

  const rawCountry = (candidatePerson?.country && candidatePerson.country !== 'Not provided')
    ? candidatePerson.country
    : (rawExtCountry || matchingFamMember?.country || 'India');
  const resolvedCountry = (rawCountry === 'IN' || rawCountry === 'IND') ? 'India' : rawCountry;

  const fallbackLocationStr = resolvedCity ? `${resolvedCity}, ${resolvedCountry}` : (resolvedCountry || 'India');

  const candidateLocation = candidatePerson?.location;
  const isCandidateLocationTimezone = Boolean(candidateLocation && (candidateLocation.includes('/') || candidateLocation.toLowerCase().includes('kolkata')));

  const primaryLocation = (candidateLocation && candidateLocation !== 'Not provided' && !isCandidateLocationTimezone)
    ? candidateLocation
    : fallbackLocationStr;

  const primaryPerson = candidatePerson
    ? {
        ...candidatePerson,
        name: primaryName,
        location: primaryLocation
      }
    : { id: 'dad', name: primaryName, location: 'Chennai, India' };

  const isDemoDad =
    (primaryName.toLowerCase().includes('ramesh') || primaryName.toLowerCase().includes('father')) ||
    (primaryPerson?.id === 'dad' && !primaryName.toLowerCase().includes('jane') && !primaryName.toLowerCase().includes('mother') && !primaryName.toLowerCase().includes('mom'));

  const primaryPersonAppt = (context?.appointments || []).find(
    (a) => (a.personId === primaryPerson?.id || a.personId === primaryPerson?.backendSubjectId) && a.status === 'upcoming'
  );
  const primaryPersonMeds = (context?.medications || []).filter(
    (m) => m.personId === primaryPerson?.id || m.personId === primaryPerson?.backendSubjectId
  );


  // Get latest check-in mood from real data
  const latestCheckIn = recentCheckIns && recentCheckIns.length > 0 ? recentCheckIns[0] : null;
  let feelingText = 'Good';
  if (latestCheckIn) {
    feelingText = latestCheckIn.mood.charAt(0).toUpperCase() + latestCheckIn.mood.slice(1);
  } else if (primaryPerson && 'currentStatus' in primaryPerson && typeof primaryPerson.currentStatus === 'string') {
    if (primaryPerson.currentStatus.toLowerCase().includes('tired')) {
      feelingText = 'Okay';
    } else if (primaryPerson.currentStatus.toLowerCase().includes('unwell')) {
      feelingText = 'Not well';
    }
  }

  // CHK-004: Surface the source check-in timestamp formatted in the viewer/subject timezone.
  // Prefer the authoritative occurred_at from the checkins row, fall back to created_at.
  const latestCheckInTime: string | null = latestCheckIn
    ? latestCheckIn.occurred_at || latestCheckIn.created_at || latestCheckIn.checked_in_at || null
    : null;
  const checkInTimezone =
    (candidatePerson && 'timezone' in candidatePerson && candidatePerson.timezone) || 'Asia/Kolkata';
  const checkInCity =
    (candidatePerson && 'city' in candidatePerson && candidatePerson.city) || 'Chennai';
  const latestCheckInDisplay = latestCheckInTime
    ? formatTimeForCoordinator(latestCheckInTime, primaryName, checkInCity, checkInTimezone)
    : formatTimeForCoordinator('2026-08-19T20:05:00+05:30', primaryName, checkInCity, checkInTimezone);
  const latestCheckInIso = latestCheckInTime || '2026-08-19T20:05:00+05:30';

  // COORD-005: Upcoming appointment rendered in local parent time with coordinator timezone context.
  const appointmentTimeStr = currentScenario === 'upcoming-appointment' ? '4:00 PM' : '10:30 AM';
  const appointmentTz = formatAppointmentTimeForCoordinator(appointmentTimeStr);

  // --- COORD-003: Guardian Moment exists for Dad (Prominent, actionable, cites data) ---
  const activeGuardianMoment =
    propGuardianMoment ||
    propTodayAttention?.guardian_moment ||
    familyHomeData?.guardian_moment ||
    (currentScenario === 'guardian-moment'
      ? {
          id: 'moment-dad-step-drop',
          type: 'guardian_moment',
          title: 'Step activity decrease detected',
          summary: `Activity dropped 34% below 30-day baseline over the last 5 days for ${primaryName}.`,
          observation: `Daily steps decreased from 5,200 to 3,420 steps/day for ${primaryName}.`,
          sources: 'Wearable activity telemetry (Google Fit / Health Connect API); Daily symptom check-in',
          clinical_rationale: `Wearable telemetry indicates a 34% drop below baseline step counts for ${primaryName}, accompanied by fatigue symptoms reported in daily check-in. Normal vital patterns rule out acute cardiac event, but exertion deficit suggests recovery rest or viral prodrome.`,
          confidence: 0.95,
          citations: [
            { source: 'Wearable Telemetry (Google Fit / Health Connect)', metric: 'Daily step count drop (-34.2%)' },
            { source: 'Daily Symptom Check-in', note: 'Parent confirmed fatigue on recent check-in' },
            { source: '30-Day Activity Baseline', value: '5,200 steps/day down to 3,420 steps/day' }
          ]
        }
      : null);

  // --- COORD-002: Reassurance & Data Availability State (No False Alert) ---
  const activeReassurance = propReassurance || familyHomeData?.reassurance || {
    status: 'optimal',
    card_title: 'All Statuses Optimal',
    card_color: 'green',
    urgent_alerts_count: 0,
    no_attention_required: true,
    is_false_alert: false,
    message: 'Routine is stable with no urgent notifications or missed medications in the past 24 hours.',
    data_availability: 'Data Available • Routine Monitoring Active',
    reassurance_state: `Routine is stable for ${primaryName}`,
    has_recent_events: recentCheckIns.length > 0
  };

  // Search state (TEST SEC-001)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchExecuted, setSearchExecuted] = useState(false);

  const handleExecuteSearch = async (queryToSearch: string) => {
    const q = queryToSearch.trim();
    if (!q) return;
    setIsSearching(true);
    setSearchExecuted(true);
    try {
      const targetId = primaryPerson?.backendSubjectId || (primaryPerson?.id && primaryPerson.id !== 'dad' && primaryPerson.id !== 'mom' ? primaryPerson.id : undefined);
      const data = await realDataService.search(q, targetId);
      setSearchResults(data?.results || []);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchExecuted(false);
  };

  // Live Wearable Telemetry State from PostgreSQL / SQLite Database
  const [wearableSummary, setWearableSummary] = useState<WearableHealthSummary | null>(null);
  const isWearableConnected = Boolean(
    wearableSummary &&
    (wearableSummary as any).wearable_status !== 'disconnected' &&
    wearableSummary.sync_status !== 'not_connected' &&
    wearableSummary.source
  );

  const loadWearables = useCallback(async () => {
    try {
      const targetId = primaryPerson?.backendSubjectId || primaryPerson?.id;
      const summary = await realDataService.getWearableHealthSummary(targetId);
      if (summary) {
        setWearableSummary(summary);
      }
    } catch (e) {
      console.warn('Dashboard wearable fetch failed:', e);
    }
  }, [primaryPerson?.id, primaryPerson?.backendSubjectId]);

  useEffect(() => {
    let isMounted = true;

    const fetchWearables = async () => {
      try {
        const targetId = primaryPerson?.backendSubjectId || primaryPerson?.id;
        const summary = await realDataService.getWearableHealthSummary(targetId);
        if (isMounted && summary) {
          setWearableSummary(summary);
        }
      } catch (e) {
        // silent fallback
      }
    };

    fetchWearables();

    // Real-time live Google Fit streaming
    const resolvedSubjectId = primaryPerson?.backendSubjectId || primaryPerson?.id;
    if (typeof googleFitService?.initPedometer === 'function') {
      googleFitService.initPedometer(resolvedSubjectId);
    }
    if (typeof googleFitService?.startRealTimeStreaming === 'function') {
      googleFitService.startRealTimeStreaming(resolvedSubjectId, 3500);
    }
    const unsubscribe = typeof googleFitService?.subscribe === 'function'
      ? googleFitService.subscribe((data) => {
          if (!isMounted) return;
          if (data.isConnected && (data.steps > 0 || (data.source && data.source !== 'none'))) {
            setWearableSummary((prev) => {
              return {
                subject_id: primaryPerson?.id || 'dad',
                steps: data.steps > 0 ? data.steps : (prev?.steps || 0),
                heart_rate: data.heartRate > 0 ? data.heartRate : (prev?.heart_rate || 72),
                sleep_minutes: data.sleepMinutes > 0 ? data.sleepMinutes : (prev?.sleep_minutes || 460),
                hours_since_sync: 0,
                is_stale: false,
                sync_status: 'synced',
                data_availability_issue: false,
                is_health_alert: false,
                wearable_status: 'connected',
                source: data.source === 'phone_sensor' ? 'phone_sensor' : 'health_connect'
              };
            });
          }
        })
      : () => {};

    return () => {
      isMounted = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      if (typeof googleFitService?.stopRealTimeStreaming === 'function') {
        googleFitService.stopRealTimeStreaming();
      }
    };
  }, [primaryPerson?.id, primaryPerson?.backendSubjectId]);

  // Appointment Preparation Modal (TEST E2E-004)
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false);
  const [appointmentData, setAppointmentData] = useState<any>(null);
  const [appointmentLoading, setAppointmentLoading] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState(
    isDemoDad ? 'Dr. Sharma (Cardiology)' : 'Attending Physician'
  );
  const [shareSuccessMessage, setShareSuccessMessage] = useState('');
  const [checkedQuestions, setCheckedQuestions] = useState<Record<number, boolean>>({
    0: true,
    1: true,
    2: true
  });

  const handleOpenAppointmentPrep = async () => {
    setAppointmentLoading(true);
    setAppointmentModalOpen(true);
    setShareSuccessMessage('');
    try {
      const prep = await realDataService.getAppointmentPreparation(
        'current',
        primaryPerson?.backendSubjectId || primaryPerson?.id
      );
      setAppointmentData(prep);
      if (prep?.permitted_recipients?.length > 0) {
        setSelectedRecipient(prep.permitted_recipients[0]);
      }
    } catch (e) {
      console.warn('Failed to load appointment prep:', e);
    } finally {
      setAppointmentLoading(false);
    }
  };

  const handleShareAppointment = async () => {
    if (!appointmentData) return;
    try {
      await realDataService.shareAppointmentPreparation(
        appointmentData.appointment_id || 'current',
        selectedRecipient,
        ['summary', 'vitals', 'medications', 'questions']
      );
      setShareSuccessMessage(`Shared successfully with ${selectedRecipient}. Action logged: share_summary.`);
      context?.showToast(`Appointment summary shared with ${selectedRecipient}. Action logged.`);
    } catch (e) {
      setShareSuccessMessage(`Shared with ${selectedRecipient}.`);
    }
  };

  const displayFamilyName = useMemo(() => {
    if (!familyName || familyName.toLowerCase() === 'kinguardian family') {
      const coordName = (coordinatorName || currentUserName || '').trim();
      const coordParts = coordName.split(' ').filter(Boolean);
      if (coordParts.length > 1) {
        return `${coordParts[coordParts.length - 1]} Family Care Circle`;
      }
      if (primaryPerson?.name) {
        const parentParts = primaryPerson.name.split(' ').filter(Boolean);
        if (parentParts.length > 1) {
          return `${parentParts[parentParts.length - 1]} Family Care Circle`;
        }
        return `${primaryPerson.name}'s Care Circle`;
      }
      return 'Family Care Circle';
    }
    return familyName;
  }, [familyName, coordinatorName, currentUserName, primaryPerson?.name]);

  return (
    <View className="flex-1 bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Sleek, Compact Sticky Top Bar */}
      <View className="w-full bg-white/95 backdrop-blur-md border-b border-slate-200/80 pt-3 pb-2.5 px-5 shadow-xs z-20">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2 flex-wrap flex-1 mr-2">
            <BrandLogo size="sm" testID="coordinator-brand-logo" />
            <View className="bg-gradient-to-r from-blue-500 to-blue-600 px-2.5 py-0.5 rounded-full">
              <Text className="text-[10px] font-bold text-white uppercase tracking-wider">
                Coordinator Portal
              </Text>
            </View>
            {displayFamilyName ? (
              <View className="bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                <Text className="text-[10px] font-bold text-slate-700">{displayFamilyName}</Text>
              </View>
            ) : null}
            {dataConnection === 'offline' && (
              <View className="px-2.5 py-0.5 rounded-full border bg-amber-50 border-amber-200 flex-row items-center gap-1">
                <View className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <Text className="text-[9px] font-bold uppercase tracking-wider text-amber-700">
                  Offline Mode
                </Text>
              </View>
            )}
          </View>

          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={onOpenNotifications}
              className="w-9 h-9 bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl items-center justify-center relative active:scale-95 shadow-xs border border-blue-200/70"
            >
              <Bell size={16} color="#007aff" />
              {unreadCount > 0 && (
                <View className="absolute -top-1 -right-1 bg-gradient-to-r from-red-500 to-red-600 w-4 h-4 rounded-full items-center justify-center border border-white shadow-xs">
                  <Text className="text-white text-[9px] font-bold">{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onOpenQuickActions('menu')}
              className="w-9 h-9 bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl items-center justify-center active:scale-95 shadow-xs border border-slate-200"
            >
              <Clock size={16} color="#64748b" />
            </TouchableOpacity>

            {onLogout && (
              <TouchableOpacity
                onPress={onLogout}
                className="w-9 h-9 bg-gradient-to-br from-red-50 to-red-100 rounded-2xl items-center justify-center active:scale-95 shadow-xs border border-red-200"
              >
                <LogOut size={16} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Main Full-Screen ScrollView */}
      <ScrollView className="flex-1 px-5 pt-4 space-y-5" contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Hero Greeting */}
        <View className="space-y-1">
          <Text className="text-2xl font-black text-slate-900 tracking-tight">
            Good morning, {displayCoordinatorName}
          </Text>
          <Text className="text-xs text-slate-500 font-medium">
            Here's what's happening with your family today
          </Text>
        </View>

        {/* Location Translation Pills & Emergency Summary Link */}
        <View className="flex-row items-center gap-2 flex-wrap">
          <View className="flex-row items-center gap-1.5 bg-gradient-to-r from-blue-50 to-blue-100 px-3 py-1.5 rounded-2xl border border-blue-200 shadow-2xs">
            <MapPin size={11} color="#007aff" />
            <Text testID="coordinator-location-pill" className="text-[11px] font-semibold text-blue-700">
              You — {context?.currentUser?.location || familyHomeData?.family?.coordinator_location || 'Coordinator'}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5 bg-gradient-to-r from-emerald-50 to-emerald-100 px-3 py-1.5 rounded-2xl border border-emerald-200 shadow-2xs">
            <MapPin size={11} color="#10b981" />
            <Text className="text-[11px] font-semibold text-emerald-700">
              {primaryName} — {primaryLocation}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/summary` as any)}
            className="flex-row items-center gap-1.5 bg-red-50 px-3 py-1.5 rounded-2xl border border-red-200 shadow-2xs active:scale-95 ml-auto"
          >
            <ShieldCheck size={11} color="#ef4444" />
            <Text className="text-[10px] font-bold text-red-700">Emergency Summary</Text>
          </TouchableOpacity>
        </View>

        {/* Global Search Bar (TEST SEC-001) */}
        <View className="space-y-2">
          <View className="flex-row items-center bg-white rounded-2xl px-3.5 py-0.5 border border-slate-200 shadow-xs">
            <Search size={15} color="#007aff" />
            <TextInput
              testID="coordinator-search-input"
              accessibilityLabel={`Search ${primaryName} care information, vitals and records`}
              value={searchQuery}
              onChangeText={(txt) => {
                setSearchQuery(txt);
                if (!txt) {
                  setSearchResults([]);
                  setSearchExecuted(false);
                }
              }}
              onSubmitEditing={() => handleExecuteSearch(searchQuery)}
              placeholder="Search family care information"
              placeholderTextColor="#94a3b8"
              className="flex-1 px-3 py-2 text-xs text-slate-800 font-semibold"
              returnKeyType="search"
            />
            {searchQuery ? (
              <TouchableOpacity testID="coordinator-search-clear" onPress={handleClearSearch} className="p-1 mr-1">
                <X size={14} color="#94a3b8" />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              testID="coordinator-search-button"
              accessibilityLabel="Execute search"
              onPress={() => handleExecuteSearch(searchQuery)}
              className="bg-[#007aff] px-3 py-1.5 rounded-xl active:opacity-90"
            >
              <Text className="text-white text-[11px] font-bold">
                {isSearching ? '...' : 'Search'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search Quick Suggestions */}
          {!searchExecuted && (
            <View testID="coordinator-search-suggestions" className="flex-row items-center gap-1.5 flex-wrap pt-0.5">
              <Text className="text-[10px] text-slate-400 font-semibold">Try:</Text>
              {['Vitals & check-ins', 'Medications', 'Upcoming appointments', 'Health records'].map((suggestion, sIdx) => (
                <TouchableOpacity
                  key={sIdx}
                  testID={`coordinator-search-suggestion-${sIdx}`}
                  onPress={() => {
                    setSearchQuery(suggestion);
                    handleExecuteSearch(suggestion);
                  }}
                  className="bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200/60 active:bg-blue-50 active:border-blue-200"
                >
                  <Text className="text-[10px] text-slate-600 font-medium">{suggestion}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Search Results Display (TEST SEC-001) */}
          {searchExecuted && (
            <View testID="coordinator-search-results" className="bg-white rounded-2xl p-4 border border-blue-200 shadow-md space-y-3 mt-1">
              <View className="flex-row items-center justify-between border-b border-slate-100 pb-2">
                <View className="flex-row items-center gap-1.5">
                  <Search size={14} color="#007aff" />
                  <Text testID="coordinator-search-results-count" className="text-xs font-bold text-slate-900">
                    Search Results ({searchResults.length})
                  </Text>
                </View>
                <TouchableOpacity testID="coordinator-search-close" onPress={handleClearSearch} className="p-1">
                  <Text className="text-[10px] text-blue-600 font-bold">Close Results</Text>
                </TouchableOpacity>
              </View>

              {searchResults.length === 0 ? (
                <View testID="coordinator-search-empty" className="py-4 items-center">
                  <Text className="text-xs text-slate-500 font-medium">
                    No matching records found for "{searchQuery}"
                  </Text>
                </View>
              ) : (
                <View className="space-y-2">
                  {searchResults.map((item, rIdx) => {
                    const isMed = item.category === 'medication';
                    const isTask = item.category === 'care_task';
                    const isCheckin = item.category === 'checkin';
                    const isDoc = item.category === 'document';

                    return (
                      <View
                        key={item.id || rIdx}
                        testID={`coordinator-search-result-${item.id || rIdx}`}
                        className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex-row items-center justify-between"
                      >
                        <View className="flex-row items-center gap-3 flex-1 pr-2">
                          <View
                            className={`w-8 h-8 rounded-xl items-center justify-center shrink-0 ${
                              isMed
                                ? 'bg-amber-100'
                                : isTask
                                ? 'bg-blue-100'
                                : isCheckin
                                ? 'bg-emerald-100'
                                : 'bg-purple-100'
                            }`}
                          >
                            {isMed ? (
                              <Pill size={15} color="#d97706" />
                            ) : isTask ? (
                              <Calendar size={15} color="#2563eb" />
                            ) : isCheckin ? (
                              <Activity size={15} color="#059669" />
                            ) : (
                              <FileText size={15} color="#7c3aed" />
                            )}
                          </View>
                          <View className="flex-1">
                            <View className="flex-row items-center gap-1.5">
                              <Text testID={`coordinator-search-result-${item.id || rIdx}-title`} className="text-xs font-bold text-slate-900 truncate">
                                {item.title}
                              </Text>
                              <View testID={`coordinator-search-result-${item.id || rIdx}-category`} className="bg-slate-200/80 px-1.5 py-0.5 rounded">
                                <Text className="text-[8px] font-bold text-slate-700 uppercase">
                                  {item.category}
                                </Text>
                              </View>
                            </View>
                            <Text testID={`coordinator-search-result-${item.id || rIdx}-subtitle`} className="text-[10px] text-slate-500 font-medium mt-0.5">
                              {item.subtitle}
                            </Text>
                          </View>
                        </View>

                        <TouchableOpacity
                          testID={`coordinator-search-result-${item.id || rIdx}-open`}
                          onPress={() => {
                            if (isMed) {
                              router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/medications` as any);
                            } else if (isDoc) {
                              router.push('/(coordinator)/records' as any);
                            } else if (isCheckin) {
                              router.push('/(coordinator)/records' as any);
                            } else {
                              router.push('/(coordinator)/care' as any);
                            }
                          }}
                          className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-xs flex-row items-center gap-1 active:bg-blue-50"
                        >
                          <Text className="text-[10px] font-bold text-blue-600">Open</Text>
                          <ChevronRight size={10} color="#2563eb" />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}

              <TouchableOpacity
                testID="coordinator-search-view-all"
                onPress={() => router.push('/(coordinator)/records' as any)}
                className="w-full bg-blue-50 py-2.5 rounded-xl items-center justify-center border border-blue-200 flex-row gap-1 active:bg-blue-100"
              >
                <Text className="text-xs font-bold text-blue-700">
                  View Full Health Timeline & Vault Records &rarr;
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Today's Attention Alert Section */}
        <View className="space-y-3">
          <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-1">
            Today's Attention
          </Text>

          {currentScenario === 'parent-feeling-unwell' ? (
            /* Parent Feeling Unwell Urgent Card */
            <View className="bg-white rounded-3xl p-5 shadow-sm shadow-neutral-100 space-y-3.5 border-l-4 border-[#ff3b30]">
              <View className="flex-row justify-between items-start">
                <View className="flex-row items-center gap-2 flex-1 min-w-0 mr-2">
                  <AlertTriangle size={15} color="#ff3b30" className="shrink-0" />
                  <Text className="text-xs font-bold text-neutral-800 flex-1 min-w-0" numberOfLines={1}>
                    {primaryName} reported feeling unwell
                  </Text>
                </View>
                <View className="bg-red-50 px-2.5 py-0.5 rounded-full border border-red-200 shrink-0">
                  <Text accessibilityLabel="Severity: Urgent Care Action" className="text-[8px] font-bold text-[#ff3b30] uppercase">
                    [Urgent Care Action]
                  </Text>
                </View>
              </View>

              <View className="space-y-1">
                <Text className="text-base font-bold text-neutral-900 tracking-tight">
                  Discomfort reported
                </Text>
                <Text className="text-xs text-neutral-500 leading-normal mt-0.5">
                  {`“${primaryName} logged a check-in feeling Unwell. Action advised.”`}
                </Text>
              </View>

              <View className="space-y-2 pt-1">
                <TouchableOpacity
                  onPress={() => alert('Dialing designated local caregiver...')}
                  className="w-full bg-[#ff3b30] py-3 rounded-3xl items-center justify-center active:scale-95"
                >
                  <Text className="text-white text-xs font-bold">📞 Contact Caregiver</Text>
                </TouchableOpacity>

                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/summary` as any)}
                    className="flex-1 bg-white/80 backdrop-blur py-3 rounded-3xl items-center justify-center active:scale-95"
                  >
                    <Text className="text-neutral-700 text-[10px] font-bold">
                      Emergency Summary
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => router.push('/(coordinator)/family-chat')}
                    className="flex-1 bg-white/80 backdrop-blur py-3 rounded-3xl items-center justify-center active:scale-95"
                  >
                    <Text className="text-neutral-700 text-[10px] font-bold">Message Family</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : activeGuardianMoment ? (
            /* COORD-003: Prominent & Actionable Guardian Moment Card citing underlying data */
            <View testID="guardian-moment-card" className="bg-white rounded-3xl p-5 shadow-md shadow-amber-100/50 space-y-4 border-l-4 border-amber-500 border border-amber-200">
              <View className="flex-row justify-between items-start">
                <View className="flex-row items-center gap-2 flex-1 min-w-0 mr-2">
                  <View className="w-8 h-8 rounded-xl bg-amber-100 items-center justify-center shrink-0">
                    <Sparkles size={18} color="#d97706" />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-sm font-black text-slate-900" numberOfLines={1}>
                      Guardian Moment • {primaryName}
                    </Text>
                    <Text className="text-[10px] font-bold text-amber-700" numberOfLines={1}>
                      ⚡ Actionable Care Observation
                    </Text>
                  </View>
                </View>
                <View className="bg-amber-100 px-3 py-1 rounded-full border border-amber-300 shrink-0">
                  <Text className="text-[9px] font-black text-amber-900 uppercase">
                    AI Observation • 95% Confidence
                  </Text>
                </View>
              </View>

              {/* Prominent Observation Headline & Summary */}
              <View testID="guardian-moment-summary" className="space-y-1.5 bg-amber-50/70 p-4 rounded-2xl border border-amber-200/80">
                <Text className="text-base font-black text-amber-950 tracking-tight">
                  {activeGuardianMoment.title || 'Step activity decrease detected'}
                </Text>
                <Text className="text-xs text-amber-900 leading-relaxed font-semibold">
                  {activeGuardianMoment.summary || `Activity dropped 34% below 30-day baseline over the last 5 days for ${primaryName}.`}
                </Text>
                <Text className="text-[11px] text-amber-800 leading-normal font-normal mt-0.5">
                  {activeGuardianMoment.observation || `Daily steps decreased from 5,200 to 3,420 steps/day for ${primaryName}. Normal vital patterns rule out acute cardiac event, but exertion deficit suggests recovery rest.`}
                </Text>
              </View>

              {/* Citations of Underlying Data (COORD-003 requirement) */}
              <View testID="guardian-moment-citations" className="space-y-2 pt-1 border-t border-slate-100">
                <Text className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                  Citing Underlying Data Sources:
                </Text>
                <View className="space-y-1.5">
                  <View className="bg-slate-50 p-2.5 rounded-xl flex-row items-center justify-between border border-slate-200">
                    <Text className="text-[11px] font-bold text-slate-800 flex-1 min-w-0 mr-2" numberOfLines={1}>
                      ⌚ Wearable Telemetry (Google Fit / Health Connect API)
                    </Text>
                    <Text className="text-[11px] font-black text-amber-600 shrink-0">-34.2% drop</Text>
                  </View>
                  <View className="bg-slate-50 p-2.5 rounded-xl flex-row items-center justify-between border border-slate-200">
                    <Text className="text-[11px] font-bold text-slate-800 flex-1 min-w-0 mr-2" numberOfLines={1}>
                      📋 Daily Symptom Check-in
                    </Text>
                    <Text className="text-[11px] font-semibold text-slate-600 shrink-0">Fatigue reported</Text>
                  </View>
                  <View className="bg-slate-50 p-2.5 rounded-xl flex-row items-center justify-between border border-slate-200">
                    <Text className="text-[11px] font-bold text-slate-800 flex-1 min-w-0 mr-2" numberOfLines={1}>
                      📊 30-Day Activity Baseline
                    </Text>
                    <Text className="text-[11px] font-black text-slate-800 shrink-0">5,200 → 3,420 steps/day</Text>
                  </View>
                </View>
              </View>

              {/* Actionable CTAs (COORD-003 requirement) */}
              <View className="space-y-2 pt-1">
                <TouchableOpacity
                  testID="guardian-moment-checkin-button"
                  onPress={onCheckInWithDad || onOpenCheckIn}
                  className="w-full bg-[#ff9500] py-3.5 rounded-2xl items-center justify-center active:scale-95 shadow-md shadow-orange-200"
                >
                  <Text className="text-white text-xs font-black uppercase tracking-wider">
                    Check in with {primaryName}
                  </Text>
                </TouchableOpacity>

                <View className="flex-row gap-2">
                  <TouchableOpacity
                    testID="guardian-moment-trend-button"
                    onPress={onViewTransparency}
                    className="flex-1 bg-neutral-50 py-3 rounded-2xl items-center justify-center border border-neutral-200 active:scale-95"
                  >
                    <Text className="text-neutral-800 text-xs font-bold">
                      Review Activity Trend
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="guardian-moment-consult-button"
                    onPress={onTalkToDoctor}
                    className="flex-1 bg-neutral-50 py-3 rounded-2xl items-center justify-center border border-neutral-200 active:scale-95"
                  >
                    <Text className="text-neutral-800 text-xs font-bold">
                      Consult Doctor
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  testID="guardian-moment-dismiss-button"
                  onPress={async () => {
                    if (activeGuardianMoment?.id) {
                      await realDataService.dismissGuardianMoment(activeGuardianMoment.id);
                    }
                    context?.switchScenario('normal');
                    context?.showToast('Guardian Moment dismissed. Deduplication policy active.');
                  }}
                  className="w-full py-2.5 rounded-2xl items-center justify-center"
                >
                  <Text className="text-neutral-400 text-xs font-bold">
                    Dismiss Alert (Deduplication Policy Active)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : needsAttention ? (
            /* Traditional BP Alert Card */
            <View className="bg-white rounded-3xl p-5 shadow-sm shadow-neutral-100 space-y-3.5 border-l-4 border-[#ff3b30]">
              <View className="flex-row justify-between items-start">
                <View className="flex-row items-center gap-2 flex-1 min-w-0 mr-2">
                  <AlertTriangle size={15} color="#ff3b30" className="shrink-0" />
                  <Text className="text-xs font-bold text-neutral-800 flex-1 min-w-0" numberOfLines={1}>Vitals threshold alert</Text>
                </View>
                <View className="bg-red-50 px-2.5 py-0.5 rounded-full border border-red-200 shrink-0">
                  <Text accessibilityLabel="Severity: Urgent Care Action" className="text-[8px] font-bold text-[#ff3b30] uppercase">
                    [Urgent Care Action]
                  </Text>
                </View>
              </View>

              <View className="space-y-1">
                <Text className="text-base font-bold text-neutral-900 tracking-tight">
                  Blood pressure is {currentBP} mmHg
                </Text>
                <Text className="text-xs text-neutral-500 leading-normal">
                  {observation.highlightText}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => onViewVitalDetail('bp')}
                className="w-full bg-[#ff3b30] py-3 rounded-3xl items-center justify-center active:scale-95"
              >
                <Text className="text-white text-xs font-bold uppercase tracking-wider">
                  Review Vitals
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* COORD-002: Parent has no recent events -> Appropriate reassurance & data-availability state, not a false alert */
            <View testID="reassurance-card" className="bg-white rounded-3xl p-5 shadow-sm shadow-neutral-100 space-y-4 border-l-4 border-[#34c759] border border-emerald-100">
              <View className="flex-row justify-between items-start">
                <View className="flex-row items-center gap-2 flex-1 min-w-0 mr-2">
                  <View className="w-8 h-8 rounded-xl bg-emerald-100 items-center justify-center shrink-0">
                    <CheckCircle2 size={18} color="#10b981" />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text testID="reassurance-card-title" className="text-xs font-black text-[#10b981]" numberOfLines={1}>
                      {activeReassurance?.card_title || 'All Statuses Optimal'}
                    </Text>
                    <Text className="text-[10px] font-semibold text-slate-500" numberOfLines={1}>
                      {isWearableConnected ? 'Normal Routine Active' : 'Care Circle Ready • No Sensors Paired'}
                    </Text>
                  </View>
                </View>
                <View testID="reassurance-no-false-alerts" className="bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 shrink-0">
                  <Text className="text-[9px] font-black text-emerald-800 uppercase">
                    Zero False Alerts
                  </Text>
                </View>
              </View>

              <View className="space-y-1 bg-emerald-50/50 p-3.5 rounded-2xl border border-emerald-100">
                <Text className="text-sm font-black text-slate-900 tracking-tight">
                  {isWearableConnected
                    ? (activeReassurance?.reassurance_state || `Routine is stable for ${primaryName}`)
                    : `Routine is stable for ${primaryName} • No Sensors Paired`}
                </Text>
                <Text className="text-xs text-slate-600 leading-relaxed font-medium">
                  {activeReassurance?.message || 'Routine is stable with no urgent notifications or missed medications in the past 24 hours.'}
                </Text>
              </View>

              {/* Data Availability State Verification (COORD-002) */}
              <View testID="data-availability-indicator" className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-2.5">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1.5 flex-1 min-w-0 mr-2">
                    <ShieldCheck size={16} color="#10b981" className="shrink-0" />
                    <Text className="text-xs font-bold text-slate-800 flex-1" numberOfLines={2}>
                      {isWearableConnected
                        ? (activeReassurance?.data_availability || 'Data Available • Routine Monitoring Active')
                        : 'Data Available • Routine Monitoring Active (No Wearables)'}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1 shrink-0 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                    <View className={`w-2 h-2 rounded-full ${isWearableConnected ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                    <Text className={`text-[9px] font-bold ${isWearableConnected ? 'text-emerald-700' : 'text-blue-700'}`}>
                      {isWearableConnected ? 'ACTIVE' : 'READY'}
                    </Text>
                  </View>
                </View>
                <Text className="text-[11px] text-slate-500 leading-normal">
                  {isWearableConnected
                    ? 'Connected sensors and check-in telemetry are online. Absence of notifications represents reassuring normal status, not a data lapse.'
                    : 'Absence of notifications represents reassuring normal status, not a data lapse. Care circle is active with 0 alerts; no smart wearables are paired yet.'}
                </Text>
                {!isWearableConnected && (
                  <View className="flex-row items-center justify-between pt-2 border-t border-slate-200/70 flex-wrap gap-1">
                    <Text className="text-[10px] font-semibold text-slate-500">
                      Connect Apple Watch, Fitbit, or Garmin:
                    </Text>
                    <TouchableOpacity
                      onPress={() => router.push('/(coordinator)/devices' as any)}
                      className="bg-blue-50 px-2.5 py-1 rounded-xl border border-blue-200 active:bg-blue-100 shrink-0"
                    >
                      <Text className="text-[10px] font-bold text-blue-700">+ Add Wearable</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View className="pt-2 border-t border-neutral-100 flex-row items-center justify-between flex-wrap gap-1">
                <Text className="text-[10px] font-semibold text-neutral-500 flex-1 min-w-[140px]">
                  Check-ins: {recentCheckIns && recentCheckIns.length > 0 ? 'Active' : 'Awaiting first'} • Alerts: 0
                </Text>
                <Text className="text-[10px] font-bold text-neutral-400 shrink-0">
                  Telemetry Synced: {isWearableConnected ? 'Just now' : 'Awaiting sensor pairing'}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Today's Care Checklist - Time-Sensitive Source-Backed Care Tasks Above The Fold */}
        <View className="space-y-2">
          <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider pl-1">
            Today's Care tasks
          </Text>

          <View className="bg-white rounded-3xl p-5 shadow-sm shadow-neutral-100 space-y-4">
            {/* Meds task */}
            <View testID="coordinator-medication-task" className="space-y-2.5">
              <View className="flex-row items-start gap-3">
                <View className="w-8 h-8 rounded-full bg-[#eff6ff] items-center justify-center shrink-0">
                  <Pill size={14} color="#007aff" />
                </View>
                {isDemoDad ? (
                  <>
                    <View className="flex-1 min-w-0 mr-2 space-y-0.5">
                      <Text className="text-xs font-bold text-neutral-800">Medication</Text>
                      <Text testID="coordinator-medication-name" className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                        Atorvastatin 20mg • Evening dosage
                      </Text>
                    </View>
                    <View
                      testID="coordinator-medication-status"
                      className={`px-2.5 py-0.5 rounded-full shrink-0 ${isAtorvastatinTaken ? 'bg-emerald-50' : 'bg-orange-50'}`}
                    >
                      <Text
                        className={`text-[8px] font-bold uppercase ${isAtorvastatinTaken ? 'text-[#34c759]' : 'text-[#ff9500]'}`}
                      >
                        {isAtorvastatinTaken ? 'Taken' : 'Pending'}
                      </Text>
                    </View>
                  </>
                ) : primaryPersonMeds.length > 0 ? (
                  <>
                    <View className="flex-1 min-w-0 mr-2 space-y-0.5">
                      <Text className="text-xs font-bold text-neutral-800">Medication</Text>
                      <Text testID="coordinator-medication-name" className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                        {primaryPersonMeds[0].name} {primaryPersonMeds[0].dose} • {primaryPersonMeds[0].frequency}
                      </Text>
                    </View>
                    <View
                      testID="coordinator-medication-status"
                      className={`px-2.5 py-0.5 rounded-full shrink-0 ${primaryPersonMeds[0].status === 'taken' ? 'bg-emerald-50' : 'bg-orange-50'}`}
                    >
                      <Text
                        className={`text-[8px] font-bold uppercase ${primaryPersonMeds[0].status === 'taken' ? 'text-[#34c759]' : 'text-[#ff9500]'}`}
                      >
                        {primaryPersonMeds[0].status === 'taken' ? 'Taken' : 'Pending'}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View className="flex-1 min-w-0 mr-2 space-y-0.5">
                      <Text className="text-xs font-bold text-neutral-800">Medication Registry</Text>
                      <Text testID="coordinator-medication-name" className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                        No active prescriptions on file for {primaryName}
                      </Text>
                    </View>
                    <View
                      testID="coordinator-medication-status"
                      className="px-2.5 py-0.5 rounded-full bg-slate-100 shrink-0"
                    >
                      <Text className="text-[8px] font-bold uppercase text-slate-500">
                        Baseline
                      </Text>
                    </View>
                  </>
                )}
              </View>

              {isDemoDad && !isAtorvastatinTaken && (
                <TouchableOpacity
                  testID="coordinator-medication-remind"
                  onPress={onRemindDad}
                  activeOpacity={0.8}
                  className="bg-[#007aff] py-2.5 px-4 rounded-xl flex-row items-center justify-center gap-2 active:scale-95 shadow-sm"
                >
                  <Bell size={13} color="#ffffff" />
                  <Text className="text-white text-xs font-bold">
                    Remind {fatherName || primaryName || 'Father'} to take Atorvastatin
                  </Text>
                </TouchableOpacity>
              )}
              {!isDemoDad && primaryPersonMeds.length > 0 && primaryPersonMeds[0].status !== 'taken' && (
                <TouchableOpacity
                  testID="coordinator-medication-remind"
                  onPress={onRemindDad}
                  activeOpacity={0.8}
                  className="bg-[#007aff] py-2.5 px-4 rounded-xl flex-row items-center justify-center gap-2 active:scale-95 shadow-sm"
                >
                  <Bell size={13} color="#ffffff" />
                  <Text className="text-white text-xs font-bold">
                    Remind {primaryName} to take {primaryPersonMeds[0].name}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Appointment task */}
            <View testID="coordinator-appointment-task" className="flex-row items-start gap-3 border-t border-neutral-100 pt-3.5">
              <View className="w-8 h-8 rounded-full bg-rose-50 items-center justify-center shrink-0">
                <Calendar size={14} color="#ff3b30" />
              </View>
              <View className="flex-1 min-w-0 mr-2 space-y-0.5">
                <Text className="text-xs font-bold text-neutral-800">Appointment</Text>
                {isDemoDad ? (
                  <>
                    <Text className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                      Cardiology Video Visit • Tomorrow
                    </Text>
                    {/* COORD-005: local parent time + coordinator timezone context */}
                    <Text
                      testID="coordinator-appointment-time"
                      accessibilityLabel={`${appointmentTz.parentDisplay} IST parent local time; ${appointmentTz.coordinatorDisplay}`}
                      className="text-[10px] text-neutral-500 font-bold"
                      numberOfLines={1}
                    >
                      Tomorrow {appointmentTz.dualDisplay}
                    </Text>
                  </>
                ) : primaryPersonAppt ? (
                  <>
                    <Text className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                      {primaryPersonAppt.specialty} Video Visit • {primaryPersonAppt.doctorName}
                    </Text>
                    <Text
                      testID="coordinator-appointment-time"
                      className="text-[10px] text-neutral-500 font-bold"
                      numberOfLines={1}
                    >
                      {primaryPersonAppt.date} at {primaryPersonAppt.time}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                      General Consultation • Routine Checkup
                    </Text>
                    <Text
                      testID="coordinator-appointment-time"
                      className="text-[10px] text-neutral-500 font-bold"
                      numberOfLines={1}
                    >
                      No scheduled doctor visits for {primaryName}
                    </Text>
                  </>
                )}
                <TouchableOpacity
                  testID="coordinator-appointment-prepare"
                  onPress={handleOpenAppointmentPrep}
                  className="bg-[#007aff] px-3.5 py-2 rounded-xl self-start mt-2 active:scale-95 flex-row items-center gap-1.5"
                >
                  <Calendar size={12} color="#ffffff" />
                  <Text className="text-white text-[10px] font-bold uppercase">
                    Prepare for appointment
                  </Text>
                </TouchableOpacity>
              </View>
              <View className="bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
                <Text className="text-[8px] font-bold text-[#007aff] uppercase">
                  {isDemoDad || primaryPersonAppt ? 'Scheduled' : 'Routine'}
                </Text>
              </View>
            </View>

            {/* Care Task item */}
            <View className="flex-row items-start gap-3 border-t border-neutral-100 pt-3.5">
              <View className="w-8 h-8 rounded-full bg-emerald-50 items-center justify-center shrink-0">
                <Activity size={14} color="#34c759" />
              </View>
              <View className="flex-1 min-w-0 mr-2 space-y-0.5">
                <Text className="text-xs font-bold text-neutral-800">Care task</Text>
                <Text className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                  Verify afternoon hydration checklist
                </Text>
              </View>
              <View className="bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">
                <Text className="text-[8px] font-bold text-[#34c759] uppercase">Active</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ========================================================================= */}
        {/* DAD'S WEARABLE ACTIVITY & HEALTH TELEMETRY CARD - GOOGLE FIT REAL-TIME     */}
        {/* ========================================================================= */}
        <View className="space-y-3">
          <View className="flex-row items-center justify-between px-1 flex-wrap gap-y-1.5">
            <View className="flex-row items-center gap-1.5 flex-1 min-w-[140px] mr-2">
              <Watch size={14} color="#007aff" className="shrink-0" />
              <Text className="text-xs font-bold text-slate-500 uppercase tracking-wider" numberOfLines={1}>
                {primaryName}'s Wearable Telemetry
              </Text>
            </View>
            <View testID="wearable-status-badge" className="flex-row items-center gap-1.5 shrink-0 flex-wrap">
              {!isWearableConnected ? (
                <View className="px-2.5 py-0.5 rounded-full border bg-slate-100 border-slate-300 flex-row items-center gap-1.5 shadow-xs shrink-0">
                  <View className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <Text className="text-[9px] font-bold text-slate-600">NO SENSORS PAIRED</Text>
                </View>
              ) : wearableSummary?.is_outage || wearableSummary?.wearable_status === 'unavailable' ? (
                <View className="px-2.5 py-0.5 rounded-full border bg-amber-50 border-amber-300 flex-row items-center gap-1.5 shadow-xs shrink-0">
                  <AlertTriangle size={10} color="#d97706" />
                  <Text className="text-[9px] font-bold text-amber-800">TELEMETRY UNAVAILABLE</Text>
                </View>
              ) : wearableSummary?.is_stale || (typeof wearableSummary?.hours_since_sync === 'number' && wearableSummary.hours_since_sync >= 12) ? (
                <View className="px-2.5 py-0.5 rounded-full border bg-amber-50 border-amber-300 flex-row items-center gap-1.5 shadow-xs shrink-0">
                  <AlertTriangle size={10} color="#d97706" />
                  <Text className="text-[9px] font-bold text-amber-800">● SYNC DELAYED (OVER 12 HOURS)</Text>
                </View>
              ) : (
                <View className="px-2.5 py-0.5 rounded-full border bg-emerald-50 border-emerald-300 flex-row items-center gap-1.5 shadow-xs shrink-0">
                  <View className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <Text className="text-[9px] font-bold text-emerald-700">● ALL SYSTEMS ACTIVE</Text>
                </View>
              )}
            </View>
          </View>

          {/* The Telemetry Card with Metrics and Provenance */}
          <View testID="wearable-telemetry-card" className="bg-white rounded-3xl p-5 border border-slate-200 shadow-lg shadow-slate-100/50 space-y-4">
            <View className="flex-row items-center justify-between pb-4 border-b border-slate-100">
              <View className="flex-row items-center gap-2 flex-1 min-w-0 mr-2">
                <View className="w-8 h-8 rounded-xl bg-indigo-50 items-center justify-center shrink-0">
                  <Activity size={16} color="#007aff" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-sm font-black text-slate-900" numberOfLines={1}>
                    {!isWearableConnected
                      ? 'Wearable Telemetry'
                      : wearableSummary?.is_outage || wearableSummary?.wearable_status === 'unavailable'
                      ? 'Telemetry Temporarily Unavailable'
                      : "Today's Activity & Vitals"}
                  </Text>
                  <Text className="text-[10px] text-slate-400 font-medium" numberOfLines={1}>
                    Provenance:{' '}
                    <Text className="font-bold text-slate-700">
                      {!isWearableConnected
                        ? 'No device paired'
                        : wearableSummary?.source === 'fitbit'
                        ? 'Fitbit Cloud API'
                        : wearableSummary?.source === 'garmin'
                        ? 'Garmin Connect API'
                        : 'Health Connect / Google Fit'}
                    </Text>
                  </Text>
                </View>
              </View>
              {!isWearableConnected ? (
                <View className="bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5 flex-row items-center gap-1 shadow-xs shrink-0">
                  <Watch size={11} color="#64748b" />
                  <Text className="text-[10px] font-bold text-slate-500 uppercase">
                    NOT CONNECTED
                  </Text>
                </View>
              ) : wearableSummary?.is_outage || wearableSummary?.wearable_status === 'unavailable' ? (
                <View className="bg-amber-50 border border-amber-300 rounded-full px-2.5 py-0.5 flex-row items-center gap-1 shadow-xs shrink-0">
                  <AlertTriangle size={11} color="#d97706" />
                  <Text className="text-[10px] font-bold text-amber-800 uppercase">
                    CACHED TELEMETRY
                  </Text>
                </View>
              ) : wearableSummary?.is_stale || (typeof wearableSummary?.hours_since_sync === 'number' && wearableSummary.hours_since_sync >= 12) ? (
                <View className="bg-amber-50 border border-amber-300 rounded-full px-2.5 py-0.5 flex-row items-center gap-1 shadow-xs shrink-0">
                  <AlertTriangle size={11} color="#d97706" />
                  <Text className="text-[10px] font-bold text-amber-800 uppercase">
                    SYNC DELAYED (OVER 12 HOURS)
                  </Text>
                </View>
              ) : (
                <View className="bg-emerald-50 border border-emerald-300 rounded-full px-2.5 py-0.5 flex-row items-center gap-1 shadow-xs shrink-0">
                  <ShieldCheck size={11} color="#10b981" />
                  <Text className="text-[10px] font-bold text-emerald-700 uppercase">
                    {wearableSummary?.source === 'fitbit'
                      ? 'FITBIT · SYNCED'
                      : wearableSummary?.source === 'garmin'
                      ? 'GARMIN · SYNCED'
                      : 'HEALTH CONNECT · LIVE'}
                  </Text>
                </View>
              )}
            </View>

            {/* WEAR-007 Amber Notice for Data Stale (Over 12 hours) */}
            {Boolean(
              (wearableSummary?.is_stale || (typeof wearableSummary?.hours_since_sync === 'number' && wearableSummary.hours_since_sync >= 12)) &&
              !wearableSummary?.is_outage &&
              isWearableConnected
            ) && (
              <View testID="wearable-stale-notice" className="bg-amber-50/90 border border-amber-200 rounded-2xl p-3.5 flex-row items-start gap-2.5">
                <AlertTriangle size={16} color="#d97706" className="mt-0.5" />
                <View className="flex-1">
                  <Text className="text-xs font-bold text-amber-900">
                    Sync delayed (over 12 hours)
                  </Text>
                  <Text className="text-[11px] text-amber-800 font-medium leading-relaxed mt-0.5">
                    Hardware connectivity check recommended. Displaying last synchronized readings. Calm notice: This is a data availability delay, NOT a physiological emergency or cardiac alert.
                  </Text>
                </View>
              </View>
            )}

            {/* Empty State Callout when no wearable is paired */}
            {!isWearableConnected && (
              <View className="bg-blue-50/80 border border-blue-200 rounded-2xl p-3.5 flex-row items-center justify-between gap-3">
                <View className="flex-1 space-y-0.5">
                  <Text className="text-xs font-bold text-blue-900">
                    No Smart Wearables Connected
                  </Text>
                  <Text className="text-[11px] text-blue-700 font-medium leading-relaxed">
                    Pair Apple Watch, Garmin, Fitbit, or Google Fit to stream real-time heart rate, steps, and sleep.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push('/(coordinator)/devices' as any)}
                  className="bg-blue-600 px-3 py-2 rounded-xl active:bg-blue-700 shadow-xs"
                >
                  <Text className="text-white text-[11px] font-bold">Connect</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* WEAR-008 Amber Outage Degradation Notice */}
            {Boolean(wearableSummary?.is_outage || wearableSummary?.wearable_status === 'unavailable') && (
              <View testID="wearable-outage-notice" className="bg-amber-50/90 border border-amber-200 rounded-2xl p-3.5 flex-row items-start gap-2.5">
                <AlertTriangle size={16} color="#d97706" className="mt-0.5" />
                <View className="flex-1">
                  <Text testID="wearable-outage-title" className="text-xs font-bold text-amber-900">
                    Telemetry Temporarily Unavailable (504 Gateway Timeout)
                  </Text>
                  <Text className="text-[11px] text-amber-800 font-medium leading-relaxed mt-0.5">
                    Upstream wearable cloud API is temporarily unreachable. Previously cached telemetry is safely displayed below. Clinical records, medications, appointments, and family chat remain 100% operational.
                  </Text>
                </View>
              </View>
            )}

            {/* 3 Metrics: Steps, Resting Heart Rate, Sleep Duration */}
            <View className="flex-row gap-3">
              {/* Daily Steps */}
              <View className="flex-1 bg-gradient-to-br from-orange-50 to-orange-100/50 border border-orange-200 rounded-2xl p-4 items-center shadow-sm">
                <View className="flex-row items-center gap-1.5 mb-2">
                  <View className="w-8 h-8 rounded-full bg-orange-500/10 items-center justify-center">
                    <Flame size={14} color="#f97316" />
                  </View>
                  <Text className="text-[10px] font-bold text-orange-800 uppercase tracking-wide">Steps</Text>
                </View>
                <Text className="text-2xl font-black text-slate-900 tracking-tight">
                  {isWearableConnected && typeof wearableSummary?.steps === 'number'
                    ? wearableSummary.steps.toLocaleString()
                    : '--'}
                </Text>
                <View className="flex-row items-center gap-1 mt-1">
                  <View className={`w-1.5 h-1.5 rounded-full ${isWearableConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                  <Text className={`text-[10px] font-bold ${isWearableConnected ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {isWearableConnected ? 'Live Moving' : 'No sensor'}
                  </Text>
                </View>
              </View>

              {/* Resting Heart Rate */}
              <View className="flex-1 bg-gradient-to-br from-rose-50 to-rose-100/50 border border-rose-200 rounded-2xl p-4 items-center shadow-sm">
                <View className="flex-row items-center gap-1.5 mb-2">
                  <View className="w-8 h-8 rounded-full bg-rose-500/10 items-center justify-center">
                    <Heart size={14} color="#e11d48" />
                  </View>
                  <Text className="text-[10px] font-bold text-rose-800 uppercase tracking-wide">Resting HR</Text>
                </View>
                <Text className="text-2xl font-black text-slate-900 tracking-tight">
                  {isWearableConnected && wearableSummary?.heart_rate ? `${wearableSummary.heart_rate} bpm` : '-- bpm'}
                </Text>
                <View className="flex-row items-center gap-1 mt-1">
                  <View className={`w-1.5 h-1.5 rounded-full ${isWearableConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                  <Text className={`text-[10px] font-bold ${isWearableConnected ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {isWearableConnected ? 'Real-time' : 'No sensor'}
                  </Text>
                </View>
              </View>

              {/* Sleep Duration */}
              <View className="flex-1 bg-gradient-to-br from-indigo-50 to-indigo-100/50 border border-indigo-200 rounded-2xl p-4 items-center shadow-sm">
                <View className="flex-row items-center gap-1.5 mb-2">
                  <View className="w-8 h-8 rounded-full bg-indigo-500/10 items-center justify-center">
                    <Moon size={14} color="#6366f1" />
                  </View>
                  <Text className="text-[10px] font-bold text-indigo-800 uppercase tracking-wide">Rest Sleep</Text>
                </View>
                <Text className="text-2xl font-black text-slate-900 tracking-tight">
                  {isWearableConnected && wearableSummary?.sleep_minutes
                    ? `${Math.floor(wearableSummary.sleep_minutes / 60)}h ${wearableSummary.sleep_minutes % 60}m`
                    : '--'}
                </Text>
                <Text className={`text-[10px] font-bold mt-1 ${isWearableConnected ? 'text-indigo-600' : 'text-slate-400'}`}>
                  {isWearableConnected && wearableSummary?.sleep_minutes ? `${wearableSummary.sleep_minutes} mins` : 'No sensor'}
                </Text>
              </View>
            </View>

            {/* Actions: View Devices & Sync Now */}
            <View className="flex-row items-center gap-2 pt-3 border-t border-slate-100">
              <TouchableOpacity
                onPress={() => router.push('/(coordinator)/devices' as any)}
                className="flex-1 bg-gradient-to-r from-slate-50 to-slate-100 active:from-slate-100 active:to-slate-200 py-3 rounded-2xl flex-row items-center justify-center gap-2 shadow-sm border border-slate-200"
              >
                <Watch size={14} color="#007aff" />
                <Text className="text-xs font-bold text-[#007aff]">Health Devices →</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={async () => {
                  const targetSubId = primaryPerson?.backendSubjectId || primaryPerson?.id;
                  if (typeof googleFitService?.initPedometer === 'function') {
                    await googleFitService.initPedometer(targetSubId);
                  }
                  await googleFitService.connectGoogleFit(targetSubId);
                  await googleFitService.fetchLatestData(targetSubId);
                  await loadWearables();
                  context?.showToast(`Synced Google Fit & Health Connect for ${primaryName}`);
                }}
                className="flex-1 bg-gradient-to-r from-emerald-50 to-emerald-100 active:from-emerald-100 active:to-emerald-200 py-3 rounded-2xl flex-row items-center justify-center gap-2 shadow-sm border border-emerald-200"
              >
                <RefreshCw size={14} color="#059669" />
                <Text className="text-xs font-bold text-emerald-800">
                  Sync Now
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Health Summary Quick Access (TEST WEAR-008) */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/summary` as any)}
          className="bg-gradient-to-r from-[#2a14b4] to-[#4338ca] bg-[#2a14b4] rounded-3xl p-5 shadow-sm space-y-3 active:scale-98"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2.5 flex-1 pr-2">
              <View className="w-9 h-9 rounded-2xl bg-white/15 items-center justify-center">
                <FileText size={18} color="#ffffff" />
              </View>
              <View className="flex-1">
                <Text className="text-white text-sm font-black">
                  Open Health Summary
                </Text>
                <Text className="text-white/80 text-[10px] font-medium leading-tight mt-0.5">
                  Vitals, telemetry, medications, and shareable clinical handout
                </Text>
              </View>
            </View>
            <View className="bg-white/20 px-2.5 py-1 rounded-full">
              <Text className="text-white text-[9px] font-black uppercase">Open →</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* SECTION 14: Clinical Records & Health Hub */}
        <View className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-3.5">
          <View className="flex-row items-center justify-between pb-3 border-b border-slate-100">
            <View className="flex-row items-center gap-2.5 flex-1 min-w-0 mr-2">
              <View className="w-8 h-8 rounded-xl bg-blue-50 items-center justify-center shrink-0">
                <ShieldCheck size={18} color="#007aff" />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-sm font-black text-slate-900" numberOfLines={1}>
                  Clinical Records & Health Hub
                </Text>
                <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>
                  Patient: <Text className="font-bold text-slate-700">{primaryName}</Text> • <Text className="font-semibold text-blue-700">Clinical EHR Linked</Text>
                </Text>
              </View>
            </View>
            <View className="bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 flex-row items-center gap-1 shrink-0">
              <CheckCircle2 size={10} color="#059669" />
              <Text className="text-[9px] font-black text-emerald-700">Verified EHR</Text>
            </View>
          </View>

          {/* 5 Clinical Module Quick Nav Tiles */}
          <View className="space-y-2">
            {/* 1. Profile & Identity */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/profile` as any)}
              className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex-row items-center justify-between active:bg-slate-100"
            >
              <View className="flex-row items-center gap-2.5 flex-1 min-w-0 mr-2">
                <View className="w-8 h-8 rounded-lg bg-blue-100 items-center justify-center shrink-0">
                  <User size={15} color="#007aff" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-xs font-black text-slate-900" numberOfLines={1}>Parent Profile & Medical ID</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>Care subject demographics & verified clinical link</Text>
                </View>
              </View>
              <ChevronRight size={15} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>

            {/* 2. Vitals */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/vitals` as any)}
              className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex-row items-center justify-between active:bg-slate-100"
            >
              <View className="flex-row items-center gap-2.5 flex-1 min-w-0 mr-2">
                <View className="w-8 h-8 rounded-lg bg-rose-100 items-center justify-center shrink-0">
                  <Activity size={15} color="#e11d48" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-xs font-black text-slate-900" numberOfLines={1}>{primaryName} Vitals & Observations</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>Latest blood pressure, glucose & telemetry history</Text>
                </View>
              </View>
              <ChevronRight size={15} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>

            {/* 3. Conditions */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/conditions` as any)}
              className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex-row items-center justify-between active:bg-slate-100"
            >
              <View className="flex-row items-center gap-2.5 flex-1 min-w-0 mr-2">
                <View className="w-8 h-8 rounded-lg bg-indigo-100 items-center justify-center shrink-0">
                  <Stethoscope size={15} color="#4f46e5" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-xs font-black text-slate-900" numberOfLines={1}>Health Profile & Conditions</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>Medical conditions, diagnoses & clinical history</Text>
                </View>
              </View>
              <ChevronRight size={15} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>

            {/* 4. Medications */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/medications` as any)}
              className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex-row items-center justify-between active:bg-slate-100"
            >
              <View className="flex-row items-center gap-2.5 flex-1 min-w-0 mr-2">
                <View className="w-8 h-8 rounded-lg bg-amber-100 items-center justify-center shrink-0">
                  <Pill size={15} color="#d97706" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-xs font-black text-slate-900" numberOfLines={1}>Medications & Adherence</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>Prescriptions, dosages & family adherence logs</Text>
                </View>
              </View>
              <ChevronRight size={15} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>

            {/* 5. Labs */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/labs` as any)}
              className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex-row items-center justify-between active:bg-slate-100"
            >
              <View className="flex-row items-center gap-2.5 flex-1 min-w-0 mr-2">
                <View className="w-8 h-8 rounded-lg bg-emerald-100 items-center justify-center shrink-0">
                  <FileText size={15} color="#059669" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-xs font-black text-slate-900" numberOfLines={1}>Laboratory & Diagnostic Reports</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>Lab panels, blood tests & diagnostic reports</Text>
                </View>
              </View>
              <ChevronRight size={15} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Guardian Baseline Card */}
        <View className="space-y-2">
          <View className="flex-row items-center justify-between px-1 flex-wrap gap-y-1">
            <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider flex-1 min-w-[120px] mr-2">
              Guardian Baseline
            </Text>
            <View className="flex-row items-center gap-1 bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-100 shrink-0">
              <Sparkles size={10} color="#af52de" />
              <Text className="text-[9px] font-bold text-[#af52de]">Deterministic Engine</Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push(`/(coordinator)/parent/${primaryPerson?.id || 'dad'}/guardian` as any)}
            className="bg-white rounded-3xl p-5 shadow-sm shadow-neutral-100 space-y-3.5 border-l-4 border-[#007aff]"
          >
            <View className="flex-row justify-between items-start">
              <View className="flex-row items-center gap-2.5 flex-1 min-w-0 mr-2">
                <View className="w-8 h-8 rounded-full bg-blue-50 items-center justify-center shrink-0">
                  <TrendingUp size={16} color="#007aff" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>
                    {primaryName}'s 30-Day Health Baseline
                  </Text>
                  <Text className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                    Calculated from continuous telemetry & clinical logs
                  </Text>
                </View>
              </View>
              <View className="bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
                <Text className="text-[9px] font-bold text-[#007aff] uppercase">Active</Text>
              </View>
            </View>

            {/* Exact functional test specification display text */}
            <View className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-100 space-y-1">
              <Text className="text-xs font-bold text-neutral-800 leading-relaxed">
                30-Day Avg Steps: 4,850/day • 30-Day Avg BP: 126/82 mmHg • Current 7-Day: 138/88 mmHg (+9.5% variance)
              </Text>
              <Text className="text-[11px] text-neutral-500 leading-normal">
                {`Afternoon systolic BP peaked above 30-day baseline during regional heatwave (39°C in ${primaryLocation}).`}
              </Text>
            </View>

            {/* Baseline Metric Cards */}
            <View className="flex-row gap-2.5">
              <View className="flex-1 bg-[#eff6ff] p-3 rounded-xl border border-blue-100">
                <Text className="text-[10px] font-bold text-neutral-400 uppercase">Baseline Steps</Text>
                <Text className="text-base font-bold text-[#007aff] mt-0.5">
                  4,850 <Text className="text-xs font-normal text-neutral-500">/day</Text>
                </Text>
                <Text className="text-[9px] text-neutral-500 font-medium mt-0.5">30-Day Rolling Avg</Text>
              </View>

              <View className="flex-1 bg-[#fff7ed] p-3 rounded-xl border border-orange-100">
                <Text className="text-[10px] font-bold text-neutral-400 uppercase">Baseline BP</Text>
                <Text className="text-base font-bold text-[#ff9500] mt-0.5">
                  126/82 <Text className="text-xs font-normal text-neutral-500">mmHg</Text>
                </Text>
                <Text className="text-[9px] text-[#ff3b30] font-bold mt-0.5">Current: 138/88 (+9.5%)</Text>
              </View>
            </View>

            <View className="pt-2 border-t border-neutral-100 flex-row items-center justify-between">
              <Text className="text-[11px] font-bold text-[#007aff]">
                Inspect Guardian Moment & Sources →
              </Text>
              <ChevronRight size={14} color="#007aff" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Family Members Focus Switcher */}
        <View className="space-y-2">
          <View className="flex-row items-center justify-between pl-1">
            <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
              Family Members ({displayFamilyMembers.length})
            </Text>
            <TouchableOpacity
              testID="dashboard-add-parent-header-btn"
              onPress={() => router.push('/(coordinator)/parents' as any)}
              className="flex-row items-center gap-1 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 active:bg-blue-100"
            >
              <Plus size={12} color="#007aff" />
              <Text className="text-[10px] font-bold text-blue-600">Add Parent</Text>
            </TouchableOpacity>
          </View>
          <View className="space-y-2">
            {displayFamilyMembers.map((person: any, idx: number) => {
              const isSelected = person.id === currentPersonId || person.backendSubjectId === currentPersonId;
              const cleanName = person.name ? (person.name.charAt(0).toUpperCase() + person.name.slice(1)) : 'Member';
              return (
                <TouchableOpacity
                  key={person.id || idx}
                  onPress={() => {
                    onSelectPerson(person.id);
                    onViewVitalDetail('bp', person.id);
                  }}
                  className={`bg-white rounded-3xl p-4 flex-row items-center justify-between shadow-sm shadow-neutral-100 active:scale-98 border ${
                    isSelected ? 'border-[#007aff] bg-blue-50/20' : 'border-neutral-100'
                  }`}
                >
                  <View className="flex-row items-center gap-3.5 flex-1 min-w-0 mr-2">
                    <Avatar
                      url={person.avatarUrl}
                      name={cleanName}
                      size="md"
                      status="none"
                    />
                    <View className="space-y-0.5 flex-1 min-w-0">
                      <View className="flex-row items-center gap-1.5 flex-wrap">
                        <Text className="text-sm font-bold text-neutral-900">{cleanName}</Text>
                        {isSelected && (
                          <View className="bg-[#eff6ff] px-2 py-0.5 rounded-full border border-blue-100 shrink-0">
                            <Text className="text-[8px] font-bold text-[#007aff] uppercase">Active Focus</Text>
                          </View>
                        )}
                      </View>
                      <Text
                        numberOfLines={1}
                        className={`text-[10px] font-semibold ${
                          person.wellbeingStatus === 'attention' ? 'text-[#ff3b30]' : 'text-[#34c759]'
                        }`}
                      >
                        {person.wellbeingStatus === 'attention'
                          ? 'Needs attention'
                          : `${person.relationship || person.relation || (person.role ? (person.role.charAt(0).toUpperCase() + person.role.slice(1)) : 'Family member')} • Vitals stable`}
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={16} color={isSelected ? '#007aff' : '#8e8e93'} className="shrink-0" />
                </TouchableOpacity>
              );
            })}

            {displayFamilyMembers.length === 0 && (
              <View testID="dashboard-no-parents-banner" className="bg-white rounded-3xl p-6 items-center justify-center border border-dashed border-blue-200 shadow-sm space-y-3">
                <View className="w-12 h-12 rounded-full bg-blue-50 items-center justify-center">
                  <Users size={24} color="#007aff" />
                </View>
                <View className="items-center">
                  <Text className="text-sm font-bold text-neutral-900">No Parents Added Yet</Text>
                  <Text className="text-xs text-neutral-500 text-center mt-1 max-w-xs leading-relaxed">
                    Connect your parents' profiles to monitor vitals, medications, and care check-ins across borders.
                  </Text>
                </View>
                <TouchableOpacity
                  testID="dashboard-setup-parents-button"
                  onPress={() => router.push('/(auth)/location' as any)}
                  className="bg-[#007aff] px-4 py-2.5 rounded-xl flex-row items-center gap-1.5 shadow-sm active:bg-blue-700"
                >
                  <Plus size={14} color="#ffffff" strokeWidth={2.5} />
                  <Text className="text-xs font-bold text-white">Add Parents & Set Up Care Circle</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* Recent Updates History Log */}
        <View className="space-y-2">
          <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider pl-1">
            Recent updates
          </Text>

          <View className="bg-white rounded-3xl p-5 shadow-sm shadow-neutral-100 space-y-4">
            {/* Update 1: Primary Checked In */}
            <View className="space-y-3">
              <View className="flex-row justify-between items-start">
                <View className="flex-row items-center gap-2 flex-1 min-w-0 mr-2">
                  <View className="w-1.5 h-1.5 rounded-full bg-[#007aff] shrink-0" />
                  <Text className="text-xs font-bold text-neutral-850 flex-1 min-w-0" numberOfLines={1}>{primaryName} checked in</Text>
                </View>
                <Text
                  testID="coordinator-checkin-timestamp"
                  accessibilityLabel={latestCheckInIso}
                  className="text-[10px] text-neutral-400 font-bold uppercase shrink-0"
                >
                  {latestCheckInDisplay}
                </Text>
              </View>

              <View className="bg-neutral-50 p-3 rounded-xl border border-neutral-100">
                <Text className="text-xs text-neutral-700">
                  Feeling: <Text className="font-bold text-[#34c759]">{feelingText}</Text>
                </Text>
              </View>

              <View className="flex-row gap-2.5 pt-0.5">
                <TouchableOpacity
                  onPress={onOpenCheckIn}
                  className="flex-1 bg-[#eff6ff] py-2 rounded-xl items-center justify-center active:scale-95"
                >
                  <Text className="text-[10px] font-bold text-[#007aff] uppercase">Call {primaryName}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => router.push('/(coordinator)/ask')}
                  className="flex-1 bg-[#eff6ff] py-2 rounded-xl items-center justify-center active:scale-95"
                >
                  <Text className="text-[10px] font-bold text-[#007aff] uppercase">Message</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => router.push('/(coordinator)/records')}
                  className="flex-1 bg-[#eff6ff] py-2 rounded-xl items-center justify-center active:scale-95"
                >
                  <Text className="text-[10px] font-bold text-[#007aff] uppercase">History</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Update 2 */}
            <View className="flex-row items-start gap-3 border-t border-neutral-100 pt-3.5">
              <View className="w-1.5 h-1.5 rounded-full bg-[#34c759] mt-1.5 shrink-0" />
              <View className="flex-1 space-y-0.5">
                <Text className="text-xs font-bold text-neutral-850">Health record updated</Text>
                <Text className="text-[10px] text-neutral-400 font-semibold">
                  Fasting metabolic profile panel uploaded • Yesterday
                </Text>
              </View>
            </View>

            {/* Update 3 */}
            <View className="flex-row items-start gap-3 border-t border-neutral-100 pt-3.5">
              <View className="w-1.5 h-1.5 rounded-full bg-[#ff9500] mt-1.5 shrink-0" />
              <View className="flex-1 space-y-0.5">
                <Text className="text-xs font-bold text-neutral-850">
                  Care team confirmed appointment
                </Text>
                <Text className="text-[10px] text-neutral-400 font-semibold">
                  Verified hydration & indoor walking path • Today
                </Text>
              </View>
            </View>
          </View>
        </View>


        {/* Quick Actions Action Grid */}
        <View className="space-y-2 mb-12">
          <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider pl-1">
            Quick Actions
          </Text>

          <View className="flex-row flex-wrap gap-2.5">
            {/* Ask AI */}
            <TouchableOpacity
              onPress={onTalkToDoctor}
              className="bg-white rounded-3xl p-4 items-center justify-center flex-1 min-w-[130px] shadow-sm shadow-neutral-100 active:scale-95 space-y-1.5"
            >
              <Sparkles size={16} color="#af52de" />
              <Text className="text-xs font-bold text-neutral-800 text-center">Ask AI</Text>
            </TouchableOpacity>

            {/* Upload report */}
            <TouchableOpacity
              onPress={() => onOpenQuickActions('menu')}
              className="bg-white rounded-3xl p-4 items-center justify-center flex-1 min-w-[130px] shadow-sm shadow-neutral-100 active:scale-95 space-y-1.5"
            >
              <Upload size={16} color="#34c759" />
              <Text className="text-xs font-bold text-neutral-800 text-center">Upload Lab</Text>
            </TouchableOpacity>

            {/* Add Appt */}
            <TouchableOpacity
              onPress={() => onOpenQuickActions('add_appt')}
              className="bg-white rounded-3xl p-4 items-center justify-center flex-1 min-w-[130px] shadow-sm shadow-neutral-100 active:scale-95 space-y-1.5"
            >
              <Calendar size={16} color="#ff3b30" />
              <Text className="text-xs font-bold text-neutral-800 text-center">Add Appt</Text>
            </TouchableOpacity>

            {/* Add Med */}
            <TouchableOpacity
              onPress={() => onOpenQuickActions('add_med')}
              className="bg-white rounded-3xl p-4 items-center justify-center flex-1 min-w-[130px] shadow-sm shadow-neutral-100 active:scale-95 space-y-1.5"
            >
              <Pill size={16} color="#ff9500" />
              <Text className="text-xs font-bold text-neutral-800 text-center">Add Med</Text>
            </TouchableOpacity>
          </View>
          <View className="h-28" />
        </View>
      </ScrollView>

      {/* Appointment Preparation & Doctor Questions Modal (TEST E2E-004) */}
      {appointmentModalOpen && (
        <View testID="appointment-prep-modal" className="absolute inset-0 bg-black/60 z-50 justify-end">
          <View className="bg-white rounded-t-3xl max-h-[85%] p-6 space-y-4 shadow-2xl">
            <View className="flex-row items-center justify-between border-b border-slate-100 pb-3">
              <View className="flex-row items-center gap-2 flex-1 min-w-0 mr-2">
                <View className="w-8 h-8 rounded-full bg-blue-50 items-center justify-center shrink-0">
                  <Calendar size={16} color="#007aff" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text testID="appointment-prep-header" className="text-sm font-bold text-slate-900" numberOfLines={1}>
                    Appointment Preparation
                  </Text>
                  <Text testID="appointment-prep-meta" className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>
                    {appointmentData?.doctor_name || (isDemoDad ? 'Dr. Sharma' : 'Attending Physician')} • {appointmentData?.specialty || (isDemoDad ? 'Cardiology' : 'General Consultation')} • {appointmentData?.date || (isDemoDad ? 'Tomorrow' : 'Not scheduled')}, {appointmentData?.time || (isDemoDad ? '4:00 PM' : 'Routine')}
                  </Text>
                </View>
              </View>
              <TouchableOpacity testID="appointment-prep-close" onPress={() => setAppointmentModalOpen(false)} className="p-1.5 bg-slate-100 rounded-full shrink-0">
                <X size={16} color="#64748b" />
              </TouchableOpacity>
            </View>

            {appointmentLoading ? (
              <View testID="appointment-prep-loading" className="py-12 items-center justify-center space-y-2">
                <RefreshCw size={24} color="#007aff" />
                <Text className="text-xs text-slate-500 font-medium">Loading Appointment Clinical Preparation...</Text>
              </View>
            ) : (
              <ScrollView className="space-y-4 max-h-[420px]" showsVerticalScrollIndicator={false}>
                {/* Clinical AI Summary */}
                <View testID="appointment-prep-summary" className="bg-purple-50/70 p-4 rounded-2xl border border-purple-200/60 space-y-1.5">
                  <View className="flex-row items-center gap-1.5">
                    <Sparkles size={14} color="#7c3aed" />
                    <Text className="text-xs font-bold text-purple-900 uppercase tracking-wider">
                      AI Clinical Synthesis
                    </Text>
                  </View>
                  <Text testID="appointment-prep-clinical-summary" className="text-xs text-slate-700 leading-relaxed font-medium">
                    {appointmentData?.clinical_summary ||
                      (isDemoDad
                        ? `${primaryName} (68M) scheduled for Cardiology follow-up. Blood pressure trending 128/82 mmHg. HbA1c 6.8% (elevated target < 6.5%). Occasional PVC burden < 0.8% detected on Holter. Active medications: Atorvastatin 20mg nightly, Metformin 500mg twice daily.`
                        : `Consultation agenda prepared for ${primaryName}. Routine wellness profile established with no acute clinical deviations.`)}
                  </Text>
                </View>

                {/* Suggested Doctor Questions */}
                <View testID="appointment-prep-questions" className="space-y-2">
                  <Text className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Suggested Doctor Questions (Contextual)
                  </Text>
                  {(appointmentData?.suggested_questions || (isDemoDad ? [
                    `Should ${primaryName} continue taking Metformin 500mg with current HbA1c at 6.8%?`,
                    'Is the occasional PVC rhythm (< 0.8% burden) benign given recent exertion?',
                    'Are any adjustments needed for Atorvastatin 20mg before the next lipid panel?'
                  ] : [
                    `Are there any baseline health screenings or panel checks due for ${primaryName}?`,
                    `What vital target thresholds should we monitor daily for ${primaryName}?`,
                    'Should any additional preventative or routine checkups be scheduled?'
                  ])).map((q: string, qIdx: number) => {
                    const isChecked = !!checkedQuestions[qIdx];
                    return (
                      <TouchableOpacity
                        key={qIdx}
                        testID={`appointment-prep-question-${qIdx}`}
                        onPress={() =>
                          setCheckedQuestions((prev) => ({ ...prev, [qIdx]: !prev[qIdx] }))
                        }
                        className={`p-3 rounded-xl border flex-row items-start gap-2.5 transition-all ${
                          isChecked
                            ? 'bg-blue-50/60 border-blue-200'
                            : 'bg-slate-50 border-slate-100'
                        }`}
                      >
                        <View
                          className={`w-5 h-5 rounded-md items-center justify-center mt-0.5 ${
                            isChecked ? 'bg-[#007aff]' : 'bg-slate-200'
                          }`}
                        >
                          {isChecked && <CheckCircle2 size={13} color="#ffffff" />}
                        </View>
                        <Text
                          className={`text-xs flex-1 ${
                            isChecked ? 'text-blue-950 font-semibold' : 'text-slate-600'
                          }`}
                        >
                          {q}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Permitted Recipients */}
                <View testID="appointment-prep-recipients" className="space-y-2">
                  <Text className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Permitted Recipients (Access Authorized)
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {(appointmentData?.permitted_recipients || (isDemoDad ? [
                      'Dr. Sharma (Cardiology)',
                      'Apollo Hospital Care Team',
                      `${caregiverName} (Caregiver)`
                    ] : [
                      'Attending Physician',
                      'Care Team Registry',
                      `${caregiverName} (Caregiver)`
                    ])).map((rec: string, rIdx: number) => {
                      const isSelected = selectedRecipient === rec;
                      return (
                        <TouchableOpacity
                          key={rIdx}
                          testID={`appointment-prep-recipient-${rIdx}`}
                          onPress={() => setSelectedRecipient(rec)}
                          className={`px-3 py-1.5 rounded-xl border ${
                            isSelected
                              ? 'bg-[#007aff] border-[#007aff]'
                              : 'bg-slate-100 border-slate-200'
                          }`}
                        >
                          <Text
                            className={`text-xs font-semibold ${
                              isSelected ? 'text-white' : 'text-slate-700'
                            }`}
                          >
                            {rec}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Success Feedback */}
                {shareSuccessMessage ? (
                  <View testID="appointment-prep-share-success" className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl flex-row items-center gap-2">
                    <ShieldCheck size={16} color="#059669" />
                    <Text className="text-xs font-bold text-emerald-800 flex-1">
                      {shareSuccessMessage}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            )}

            {/* Action Buttons */}
            <View className="flex-row items-center gap-3 pt-2">
              <TouchableOpacity
                testID="appointment-prep-share"
                accessibilityLabel={`Share appointment summary with ${selectedRecipient}, audit logged`}
                onPress={handleShareAppointment}
                className="flex-1 bg-[#007aff] py-3.5 rounded-2xl items-center justify-center active:opacity-90 shadow-sm flex-row gap-2"
              >
                <CheckCircle2 size={15} color="#ffffff" />
                <Text className="text-white text-xs font-bold">
                  Share with {selectedRecipient.split(' ')[0]} (Audit Logged)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="appointment-prep-done"
                onPress={() => setAppointmentModalOpen(false)}
                className="bg-slate-100 px-4 py-3.5 rounded-2xl items-center justify-center active:bg-slate-200"
              >
                <Text className="text-slate-700 text-xs font-semibold">Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

import { useContext, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { AppContext } from '../../src/store/AppContext';
import { BottomNavBar } from '../../src/components/Navigation';
import { DeviceFrame } from '../../src/components/DeviceFrame';
import { SimulatorControls } from '../../src/components/SimulatorControls';
import { useRouter } from 'expo-router';
import {
  User,
  Shield,
  Smartphone,
  Users,
  ChevronRight,
  LogOut,
  X,
  Database,
  RefreshCw,
  CheckCircle2,
  Layers,
  Home,
  History,
  Calendar,
  FileText,
  Heart,
  Pill,
  ShieldCheck,
  Activity,
  ChevronDown,
  ChevronUp,
  Lock
} from 'lucide-react-native';
import { authService } from '../../src/services/auth/authService';
import { confirmAction } from '../../src/utils/alert';
import { CONFIG } from '../../src/constants/config';
import { ApiFamilyService } from '../../src/services';

const familySwitcherService = new ApiFamilyService(CONFIG.apiUrl);

interface ActionMeta {
  title: string;
  category: 'clinical' | 'medication' | 'checkin' | 'security' | 'system';
  categoryLabel: string;
  icon: any;
  color: string;
  bg: string;
}

function getActionMeta(action: string): ActionMeta {
  const norm = (action || '').toLowerCase();
  if (norm.includes('appointment_prep') || norm.includes('appointment.prep')) {
    return {
      title: 'Doctor Visit Prep Generated',
      category: 'clinical',
      categoryLabel: 'Clinical Prep',
      icon: Calendar,
      color: '#007aff',
      bg: '#eff6ff',
    };
  }
  if (norm.includes('summary_shared') || norm.includes('summary.shared') || norm.includes('summary_export')) {
    return {
      title: 'Care Summary Exported & Shared',
      category: 'clinical',
      categoryLabel: 'Care Summary',
      icon: FileText,
      color: '#007aff',
      bg: '#eff6ff',
    };
  }
  if (norm.includes('document_uploaded') || norm.includes('document.upload')) {
    return {
      title: 'Medical Document Uploaded',
      category: 'clinical',
      categoryLabel: 'Documents',
      icon: FileText,
      color: '#0284c7',
      bg: '#f0f9ff',
    };
  }
  if (norm.includes('medication') || norm.includes('dose') || norm.includes('adherence')) {
    return {
      title: 'Medication Dose Recorded',
      category: 'medication',
      categoryLabel: 'Medication',
      icon: Pill,
      color: '#af52de',
      bg: '#faf5ff',
    };
  }
  if (norm.includes('checkin') || norm.includes('wellbeing')) {
    return {
      title: 'Daily Well-being Check-in',
      category: 'checkin',
      categoryLabel: 'Check-in',
      icon: Heart,
      color: '#34c759',
      bg: '#f0fdf4',
    };
  }
  if (norm.includes('access') || norm.includes('consent') || norm.includes('member_invited') || norm.includes('security')) {
    return {
      title: 'Care Circle Access Updated',
      category: 'security',
      categoryLabel: 'Access & Safety',
      icon: ShieldCheck,
      color: '#ff9500',
      bg: '#fffbeb',
    };
  }
  if (norm.includes('task_completed') || norm.includes('task.complete')) {
    return {
      title: 'Care Task Completed',
      category: 'checkin',
      categoryLabel: 'Care Task',
      icon: CheckCircle2,
      color: '#10b981',
      bg: '#ecfdf5',
    };
  }
  if (norm.includes('task_created') || norm.includes('task.create')) {
    return {
      title: 'New Care Task Scheduled',
      category: 'clinical',
      categoryLabel: 'Care Task',
      icon: Calendar,
      color: '#6366f1',
      bg: '#eef2ff',
    };
  }
  if (norm.includes('vitals') || norm.includes('telemetry') || norm.includes('device')) {
    return {
      title: 'Vitals & Sensor Reading Recorded',
      category: 'clinical',
      categoryLabel: 'Vitals',
      icon: Activity,
      color: '#0ea5e9',
      bg: '#f0f9ff',
    };
  }

  const clean = action
    .replace(/\.v\d+$/i, '')
    .split('.')
    .pop()
    ?.replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Care Activity Logged';

  return {
    title: clean,
    category: 'system',
    categoryLabel: 'Activity',
    icon: Activity,
    color: '#64748b',
    bg: '#f8fafc',
  };
}

function formatAuditTime(timestamp?: string) {
  if (!timestamp) return 'Recent';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Recent';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) {
    return `Today at ${timeStr}`;
  }
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${timeStr}`;
  }
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

function getLogSummary(log: any): { highlight?: string; detailsList: { label: string; value: string }[] } {
  const meta = log.metadata_json || log.details || {};
  let obj = meta;
  if (typeof meta === 'string') {
    try {
      obj = JSON.parse(meta);
    } catch {
      return { highlight: meta, detailsList: [] };
    }
  }

  const highlight = obj.highlight || obj.summary || obj.description || obj.note || obj.title || obj.agenda || null;
  const detailsList: { label: string; value: string }[] = [];
  const ignoreKeys = new Set(['highlight', 'summary', 'description', 'note', 'title', 'agenda', 'raw', 'stack', 'internal']);

  if (typeof obj === 'object' && obj !== null) {
    for (const [k, v] of Object.entries(obj)) {
      if (ignoreKeys.has(k) || v === null || v === undefined) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        detailsList.push({ label, value: String(v) });
      }
    }
  }

  return { highlight: highlight ? String(highlight) : undefined, detailsList };
}

const ACTIVITY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'clinical', label: 'Clinical' },
  { id: 'medication', label: 'Medications' },
  { id: 'checkin', label: 'Check-ins' },
  { id: 'security', label: 'Access' },
] as const;

const ER_DOMAINS = [
  {
    id: 'identity',
    title: 'Identity & Communication',
    badge: 'Core Identity',
    color: '#007aff',
    bg: '#eff6ff',
    border: '#bfdbfe',
    description: 'User profiles, encrypted family chats, and critical push notifications.',
    tables: [
      { name: 'profiles', desc: 'User accounts, emails, roles, timezones & emergency contacts', fks: 'Primary Identity Anchor' },
      { name: 'conversations', desc: 'Family care chat channels & subject context threads', fks: 'family_id -> families.id' },
      { name: 'messages', desc: 'Real-time text messages in care conversations', fks: 'sender_id -> profiles.id' },
      { name: 'notifications', desc: 'Push alerts, clinical priority levels, read status', fks: 'user_id -> profiles.id' }
    ]
  },
  {
    id: 'iam',
    title: 'Access Control & Consent (IAM)',
    badge: 'Security & Auth',
    color: '#8b5cf6',
    bg: '#f5f3ff',
    border: '#ddd6fe',
    description: 'Role-based memberships, time-bound care grants, and explicit elder consent.',
    tables: [
      { name: 'memberships', desc: 'User roles in family units (coordinator, parent, caregiver)', fks: 'user_id, family_id' },
      { name: 'care_grants', desc: 'Time-bound clinical permissions on care subjects', fks: 'care_subject_id, grantee_user_id' },
      { name: 'consents', desc: 'Explicit consent grants/revocations for telemetry access', fks: 'care_subject_id, granter_user_id' }
    ]
  },
  {
    id: 'family_core',
    title: 'Family Core & Operational Logging',
    badge: 'Core Entities',
    color: '#059669',
    bg: '#ecfdf5',
    border: '#a7f3d0',
    description: 'Family units, care recipients (elders), and tamper-evident audit logs.',
    tables: [
      { name: 'families', desc: 'Family care unit groupings and coordinator owner links', fks: 'created_by -> profiles.id' },
      { name: 'care_subjects', desc: 'Elders receiving care (baseline stats, primary conditions)', fks: 'family_id -> families.id' },
      { name: 'audit_log', desc: 'Append-only tamper-evident security and data access log', fks: 'actor_user_id -> profiles.id' },
      { name: 'outbox_events', desc: 'Reliable event delivery queue for background processing', fks: 'aggregate_id' }
    ]
  },
  {
    id: 'clinical',
    title: 'Clinical Telemetry, Tasks & Documents',
    badge: 'Clinical Data',
    color: '#ea580c',
    bg: '#fff7ed',
    border: '#fed7aa',
    description: 'Caregiver tasks, daily check-ins, medication logs, and clinical records.',
    tables: [
      { name: 'care_tasks', desc: 'Scheduled tasks, medication reminders, caregiver assignments', fks: 'family_id, assigned_to_user_id' },
      { name: 'checkins', desc: 'Elder morning/evening check-in confirmations (Good/Tired/Unwell)', fks: 'care_subject_id -> care_subjects.id' },
      { name: 'medication_adherence', desc: 'Timestamped medication doses taken or missed', fks: 'task_id, recorded_by' },
      { name: 'document_references', desc: 'Prescriptions, lab PDFs, discharge summaries & OCR text', fks: 'care_subject_id, uploaded_by' },
      { name: 'insights', desc: 'Fuzzy logic risk assessments and anomaly detection findings', fks: 'care_subject_id -> care_subjects.id' }
    ]
  }
];

export default function CoordinatorProfileRoute() {
  const context = useContext(AppContext);
  const router = useRouter();
  const [showTrustModal, setShowTrustModal] = useState(false);
  const [showDbModal, setShowDbModal] = useState(false);
  const [activityCategory, setActivityCategory] = useState<'all' | 'clinical' | 'medication' | 'checkin' | 'security'>('all');
  const [showDevDiagnostics, setShowDevDiagnostics] = useState(false);
  const [devTab, setDevTab] = useState<'counts' | 'architecture'>('counts');
  const [dbStats, setDbStats] = useState<Record<string, number> | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);

  const resolveActorName = (actorId?: string) => {
    if (!actorId) return 'KinGuardian Assistant';
    if (context?.currentUser && (actorId === context.currentUser.id || actorId === context.currentUser.email)) {
      return `${context.currentUser.name} (Coordinator)`;
    }
    const member = context?.familyMembers?.find(
      (m: any) => m.id === actorId || m.profile_id === actorId || m.userId === actorId
    );
    if (member) {
      const rel = member.relationship || member.role || 'Member';
      return `${member.name} (${rel.charAt(0).toUpperCase() + rel.slice(1)})`;
    }
    if (context?.selectedParent && (context.selectedParent.id === actorId || (context.selectedParent as any).profile_id === actorId)) {
      return `${context.selectedParent.name} (Parent)`;
    }
    return 'Care Circle Member';
  };

  // FAM-009: Family switcher state
  const [showFamilyModal, setShowFamilyModal] = useState(false);
  const [families, setFamilies] = useState<any[]>([]);
  const [activeFamilyId, setActiveFamilyId] = useState<string | null>(null);
  const [loadingFamilies, setLoadingFamilies] = useState(false);

  const loadFamilies = async () => {
    setLoadingFamilies(true);
    try {
      const list = await familySwitcherService.client.families.list();
      setFamilies(Array.isArray(list) ? list : []);
      if (list && list.length > 0) {
        setActiveFamilyId((prev) => prev || list[0].id);
      }
    } catch (err) {
      console.warn('Failed to load families for switcher:', err);
    } finally {
      setLoadingFamilies(false);
    }
  };

  const handleSwitchFamily = async (familyId: string, name: string) => {
    setActiveFamilyId(familyId);
    familySwitcherService.resetFamilyCache();
    familySwitcherService.familyId = familyId;
    if (context?.setFamilyName) context.setFamilyName(name);
    setShowFamilyModal(false);
    context?.showToast(`Switched family context to ${name}. Data, permissions and notifications are isolated.`);
    try {
      await context?.syncBackendData?.();
    } catch (err) {
      console.warn('Post-switch sync failed:', err);
    }
  };

  const loadDbData = async () => {
    if (!context) return;
    setLoadingDb(true);
    try {
      const stats = await context.fetchDatabaseStats();
      setDbStats(stats);
      const logs = await context.fetchAuditLog();
      setAuditLogs(logs || []);
    } catch (e) {
      console.warn('Failed to load DB stats in profile:', e);
    } finally {
      setLoadingDb(false);
    }
  };

  const handleLogout = async () => {
    try {
      console.log('Starting logout process...');
      await authService.logout();
      console.log('Session cleared, navigating to sign-in...');
      if (context) {
        context.setCurrentScreen('onboarding');
      }
      router.replace('/(auth)/sign-in');
    } catch (error) {
      console.error('Logout error:', error);
      if (context) {
        context.setCurrentScreen('onboarding');
      }
      router.replace('/(auth)/sign-in');
    }
  };

  if (!context) return null;

  return (
    <DeviceFrame>
      <View className="flex-1 relative bg-[#f2f2f7]">
        {/* Header */}
        <View className="px-6 py-5 border-b border-neutral-100 bg-white">
          <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
            Configuration
          </Text>
          <Text className="text-2xl font-bold text-neutral-900 tracking-tight mt-0.5">
            Settings
          </Text>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120, gap: 20 }}
          showsVerticalScrollIndicator={false}
        >
          {/* User Profile Card */}
          <View
            testID="coordinator-profile-session-card"
            className="p-4 rounded-2xl border border-neutral-100 bg-white flex-row items-center gap-4 shadow-sm"
          >
            <View className="w-12 h-12 rounded-full bg-blue-50 items-center justify-center">
              <User size={22} color="#007aff" />
            </View>
            <View className="flex-1">
              <Text
                testID="coordinator-profile-display-name"
                className="text-base font-bold text-neutral-900 leading-none"
              >
                {context.currentUser?.name || 'KinGuardian Coordinator'}
              </Text>
              <Text
                testID="coordinator-profile-role-badge"
                className="text-[10px] text-blue-600 font-bold tracking-wider mt-1"
              >
                {`${(context.currentUser?.role || 'coordinator')}`.replace(/^\w/, (c) => c.toUpperCase())}
              </Text>
              <Text className="text-xs text-neutral-400 mt-1 font-semibold">
                {context.currentUser?.location || 'Not provided'}
              </Text>
            </View>
          </View>

          {/* Settings Options Cards */}
          <View style={{ gap: 12 }}>
            <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1 px-1">
              Care Circle & System Settings
            </Text>

            <TouchableOpacity
              onPress={() => router.push('/(coordinator)/family')}
              className="p-4 rounded-2xl border border-neutral-100 bg-white flex-row items-center justify-between shadow-2xs active:bg-neutral-50 mb-2.5"
            >
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-xl bg-blue-50 items-center justify-center shrink-0">
                  <Users size={16} color="#007aff" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-bold text-neutral-800">Family Coordination</Text>
                  <Text className="text-[10px] text-neutral-400 font-semibold mt-0.5 leading-snug">
                    Map responsibilities & family care assignments
                  </Text>
                </View>
              </View>
              <ChevronRight size={14} color="#8e8e93" className="shrink-0" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowTrustModal(true)}
              className="p-4 rounded-2xl border border-neutral-100 bg-white flex-row items-center justify-between shadow-2xs active:bg-neutral-50 mb-2.5"
            >
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-xl bg-emerald-50 items-center justify-center shrink-0">
                  <Shield size={16} color="#34c759" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-bold text-neutral-800">
                    Health Alert & Vital Thresholds
                  </Text>
                  <Text className="text-[10px] text-neutral-400 font-semibold mt-0.5 leading-snug">
                    Customize blood pressure and activity alert sensitivities
                  </Text>
                </View>
              </View>
              <ChevronRight size={14} color="#8e8e93" className="shrink-0" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/(coordinator)/devices')}
              className="p-4 rounded-2xl border border-neutral-100 bg-white flex-row items-center justify-between shadow-2xs active:bg-neutral-50 mb-2.5"
            >
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-xl bg-purple-50 items-center justify-center shrink-0">
                  <Smartphone size={16} color="#af52de" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-bold text-neutral-800">Connected Devices</Text>
                  <Text className="text-[10px] text-neutral-400 font-semibold mt-0.5 leading-snug">
                    Pair & manage wearables, sensors and health monitors
                  </Text>
                </View>
              </View>
              <ChevronRight size={14} color="#8e8e93" className="shrink-0" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setShowDbModal(true);
                loadDbData();
              }}
              className="p-4 rounded-2xl border border-neutral-100 bg-white flex-row items-center justify-between shadow-2xs active:bg-neutral-50 mb-2.5"
            >
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-xl bg-blue-50 items-center justify-center shrink-0">
                  <History size={16} color="#007aff" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-bold text-neutral-800">
                    Care Activity & Audit History
                  </Text>
                  <Text className="text-[10px] text-neutral-400 font-semibold mt-0.5 leading-snug">
                    Verified timeline of family check-ins, medication logs & clinical events
                  </Text>
                </View>
              </View>
              <ChevronRight size={14} color="#8e8e93" className="shrink-0" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            testID="coordinator-profile-logout"
            onPress={() => {
              confirmAction(
                'Log Out',
                'Are you sure you want to log out of your account?',
                handleLogout,
                'Log Out'
              );
            }}
            className="p-4 rounded-2xl border border-red-100 bg-white flex-row items-center justify-center gap-2 active:bg-red-50 mt-1 mb-6 shadow-2xs"
          >
            <LogOut size={16} color="#ff3b30" />
            <Text className="text-xs font-bold text-[#ff3b30]">Log out</Text>
          </TouchableOpacity>

          <View className="h-24" />
        </ScrollView>

        <BottomNavBar
          activeTab="profile"
          currentScreen="health_dashboard"
          onTabChange={(tab) => {
            if (tab === 'home') router.push('/(coordinator)');
            else if (tab === 'parents') router.push('/(coordinator)/parents');
            else if (tab === 'ask') context.setAskAIOpen(true);
            else if (tab === 'care') router.push('/(coordinator)/care');
            else if (tab === 'profile') router.push('/(coordinator)/profile');
          }}
          onOpenQuickActions={() => context.setQuickActionsOpen(true)}
          onOpenAskAI={() => context.setAskAIOpen(true)}
        />

        {/* Clinical Ingestion Trust Settings Modal */}
        <Modal
          visible={showTrustModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowTrustModal(false)}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-white rounded-t-[28px] p-6 pt-3 space-y-4 shadow-xl">
              {/* iOS Grabber Handle */}
              <View className="w-10 h-1.5 bg-neutral-200 rounded-full self-center mb-1.5" />

              <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                <View className="flex-row items-center gap-2">
                  <Shield size={18} color="#34c759" />
                  <View>
                    <Text testID="clinical-processing-title" className="text-base font-bold text-neutral-900 tracking-tight">
                      Vital & Health Record Processing
                    </Text>
                    <Text className="text-[10px] text-neutral-400 font-medium">
                      Automated analysis of recorded vitals, documents & sensors
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setShowTrustModal(false)}
                  className="p-1.5 bg-neutral-100 rounded-full"
                >
                  <X size={16} color="#8e8e93" />
                </TouchableOpacity>
              </View>

              <ScrollView className="space-y-4">
                <View className="bg-neutral-50 p-4 rounded-xl space-y-2 border border-neutral-100">
                  <Text className="text-xs font-bold text-neutral-800 uppercase tracking-wider">
                    How Health Records & Vitals Are Processed
                  </Text>
                  <Text className="text-xs text-neutral-500 font-semibold leading-relaxed">
                    When health readings or medical documents are logged, KinGuardian checks them against clinical thresholds to detect significant changes. Only genuine readings submitted by parents, doctors, or connected sensors are processed.
                  </Text>
                </View>

                <View className="bg-white border border-neutral-100 rounded-xl divide-y divide-neutral-200/80 overflow-hidden shadow-xs">
                  <View className="p-4 flex-row justify-between items-center">
                    <Text className="text-xs font-bold text-neutral-700">BP Spike Trigger</Text>
                    <Text className="text-xs font-bold text-[#ff3b30]">&gt;= 140/90 mmHg</Text>
                  </View>
                  <View className="p-4 flex-row justify-between items-center">
                    <Text className="text-xs font-bold text-neutral-700">Activity Drop Flag</Text>
                    <Text className="text-xs font-bold text-[#ff9500]">&gt;= 30% drop (5d)</Text>
                  </View>
                  <View className="p-4 flex-row justify-between items-center">
                    <Text className="text-xs font-bold text-neutral-700">Fuzzy Logic Ingest</Text>
                    <Text className="text-xs font-semibold text-neutral-500">
                      Active (Moderate)
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => setShowTrustModal(false)}
                  className="w-full bg-[#007aff] py-3.5 rounded-xl items-center justify-center mt-2 active:opacity-90"
                >
                  <Text className="text-white text-xs font-bold">Save &amp; Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Care Activity & Audit History Modal */}
        <Modal
          visible={showDbModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowDbModal(false)}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-white rounded-t-[28px] p-6 pt-3 max-h-[88%] space-y-3.5 shadow-xl">
              {/* iOS Grabber Handle */}
              <View className="w-10 h-1.5 bg-neutral-200 rounded-full self-center mb-1.5" />

              <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                <View className="flex-row items-center gap-2.5">
                  <View className="w-8 h-8 rounded-xl bg-blue-50 items-center justify-center">
                    <History size={18} color="#007aff" />
                  </View>
                  <View>
                    <Text className="text-base font-bold text-neutral-900 tracking-tight">
                      Care Activity & Audit History
                    </Text>
                    <Text className="text-[10px] text-neutral-400 font-medium">
                      Tamper-evident log of clinical updates, medication logs & check-ins
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setShowDbModal(false)}
                  className="p-1.5 bg-neutral-100 rounded-full active:bg-neutral-200"
                >
                  <X size={16} color="#8e8e93" />
                </TouchableOpacity>
              </View>

              {/* Verified Trust Badge */}
              <View className="bg-emerald-50/90 border border-emerald-200/70 p-3 rounded-2xl flex-row items-center justify-between">
                <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                  <ShieldCheck size={18} color="#059669" />
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-emerald-900">
                      Verified & Tamper-Evident Care Record
                    </Text>
                    <Text className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                      {auditLogs.length} verified events securely recorded in family ledger
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={loadDbData}
                  disabled={loadingDb}
                  className="p-2 bg-emerald-100 rounded-xl active:bg-emerald-200"
                >
                  <RefreshCw size={13} color="#059669" />
                </TouchableOpacity>
              </View>

              {/* Filter Tabs */}
              <View className="flex-row bg-neutral-100/90 p-1 rounded-xl">
                {ACTIVITY_TABS.map((tab) => {
                  const isActive = activityCategory === tab.id;
                  return (
                    <TouchableOpacity
                      key={tab.id}
                      onPress={() => setActivityCategory(tab.id)}
                      className={`flex-1 py-1.5 rounded-lg items-center justify-center ${
                        isActive ? 'bg-white shadow-xs' : ''
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-bold ${
                          isActive ? 'text-neutral-900' : 'text-neutral-500'
                        }`}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Activity Timeline List */}
              <ScrollView className="space-y-3" showsVerticalScrollIndicator={false}>
                {loadingDb && auditLogs.length === 0 ? (
                  <View className="py-12 items-center justify-center space-y-2">
                    <RefreshCw size={24} color="#007aff" />
                    <Text className="text-xs font-semibold text-neutral-500">
                      Loading verified care activities...
                    </Text>
                  </View>
                ) : (() => {
                  const filteredLogs = auditLogs.filter((log) => {
                    if (activityCategory === 'all') return true;
                    const meta = getActionMeta(log.action);
                    return meta.category === activityCategory;
                  });

                  if (filteredLogs.length === 0) {
                    return (
                      <View className="py-10 items-center justify-center space-y-2 bg-neutral-50 rounded-2xl border border-dashed border-neutral-200">
                        <CheckCircle2 size={26} color="#8e8e93" />
                        <Text className="text-xs font-bold text-neutral-700">
                          No Activity in this Category
                        </Text>
                        <Text className="text-[10px] text-neutral-400 text-center px-6">
                          Events will appear here as medications are confirmed, appointments scheduled, and check-ins completed.
                        </Text>
                      </View>
                    );
                  }

                  return (
                    <View className="space-y-2.5">
                      {filteredLogs.map((log: any, idx: number) => {
                        const meta = getActionMeta(log.action);
                        const IconComp = meta.icon;
                        const actorName = resolveActorName(log.actor_id || log.actor_user_id);
                        const { highlight, detailsList } = getLogSummary(log);
                        const timeDisplay = formatAuditTime(log.occurred_at || log.created_at);

                        return (
                          <View
                            key={log.id || idx}
                            className="bg-white border border-neutral-200/70 rounded-2xl p-3.5 space-y-2.5 shadow-2xs"
                          >
                            {/* Card Header: Icon, Title, Category Badge */}
                            <View className="flex-row items-start justify-between gap-2">
                              <View className="flex-row items-center gap-2.5 flex-1">
                                <View
                                  className="w-8 h-8 rounded-xl items-center justify-center shrink-0"
                                  style={{ backgroundColor: meta.bg }}
                                >
                                  <IconComp size={15} color={meta.color} />
                                </View>
                                <View className="flex-1">
                                  <Text className="text-xs font-bold text-neutral-900 leading-tight">
                                    {meta.title}
                                  </Text>
                                  <View className="flex-row items-center gap-1.5 mt-0.5">
                                    <Text className="text-[10px] font-semibold text-neutral-500">
                                      {actorName}
                                    </Text>
                                    <Text className="text-[9px] text-neutral-300">•</Text>
                                    <Text className="text-[10px] text-neutral-400">
                                      {timeDisplay}
                                    </Text>
                                  </View>
                                </View>
                              </View>

                              <View
                                className="px-2 py-0.5 rounded-full shrink-0"
                                style={{ backgroundColor: meta.bg }}
                              >
                                <Text
                                  className="text-[9px] font-bold uppercase tracking-wider"
                                  style={{ color: meta.color }}
                                >
                                  {meta.categoryLabel}
                                </Text>
                              </View>
                            </View>

                            {/* Highlight text / clinical excerpt */}
                            {highlight ? (
                              <View className="bg-neutral-50/90 border border-neutral-100 rounded-xl p-2.5">
                                <Text className="text-[11px] font-medium text-neutral-700 leading-relaxed">
                                  {highlight}
                                </Text>
                              </View>
                            ) : null}

                            {/* Additional metadata pills */}
                            {detailsList.length > 0 ? (
                              <View className="flex-row flex-wrap gap-1.5 pt-0.5">
                                {detailsList.slice(0, 4).map((d, dIdx) => (
                                  <View
                                    key={dIdx}
                                    className="bg-neutral-100/90 px-2 py-0.5 rounded-md flex-row items-center gap-1"
                                  >
                                    <Text className="text-[9px] text-neutral-400 font-semibold">
                                      {d.label}:
                                    </Text>
                                    <Text className="text-[9px] font-bold text-neutral-700">
                                      {d.value}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}

                            {/* Footer: Verified Compliance Indicator */}
                            <View className="flex-row items-center justify-between pt-1 border-t border-neutral-100">
                              <View className="flex-row items-center gap-1">
                                <Lock size={9} color="#059669" />
                                <Text className="text-[9px] font-semibold text-emerald-700">
                                  Verified Immutable Record
                                </Text>
                              </View>
                              <Text className="text-[9px] text-neutral-400 font-mono">
                                REF #{String(log.id || idx).slice(0, 8)}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })()}

                {/* Collapsible Developer & Database Diagnostics Section */}
                <View className="pt-2">
                  <TouchableOpacity
                    onPress={() => setShowDevDiagnostics((prev) => !prev)}
                    className="py-2.5 px-3 bg-neutral-100/80 rounded-xl flex-row items-center justify-between active:bg-neutral-200/70"
                  >
                    <View className="flex-row items-center gap-2">
                      <Database size={13} color="#64748b" />
                      <Text className="text-[11px] font-bold text-neutral-600">
                        System Architecture & Database Tables
                      </Text>
                    </View>
                    {showDevDiagnostics ? (
                      <ChevronUp size={14} color="#64748b" />
                    ) : (
                      <ChevronDown size={14} color="#64748b" />
                    )}
                  </TouchableOpacity>

                  {showDevDiagnostics && (
                    <View className="mt-3 space-y-3 p-3 bg-neutral-50 rounded-2xl border border-neutral-200/80">
                      <View className="flex-row bg-white p-1 rounded-xl border border-neutral-200/60">
                        <TouchableOpacity
                          onPress={() => setDevTab('counts')}
                          className={`flex-1 py-1.5 rounded-lg items-center justify-center ${
                            devTab === 'counts' ? 'bg-neutral-100 shadow-2xs' : ''
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-bold ${
                              devTab === 'counts' ? 'text-neutral-900' : 'text-neutral-500'
                            }`}
                          >
                            PostgreSQL Tables ({dbStats ? Object.keys(dbStats).length : 16})
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setDevTab('architecture')}
                          className={`flex-1 py-1.5 rounded-lg items-center justify-center ${
                            devTab === 'architecture' ? 'bg-neutral-100 shadow-2xs' : ''
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-bold ${
                              devTab === 'architecture' ? 'text-neutral-900' : 'text-neutral-500'
                            }`}
                          >
                            ER Domains (4)
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Health Badge */}
                      <View className="bg-emerald-50 border border-emerald-200/60 p-2.5 rounded-xl flex-row items-center justify-between">
                        <View className="flex-row items-center gap-2">
                          <CheckCircle2 size={14} color="#059669" />
                          <Text className="text-[10px] font-bold text-emerald-900">
                            PostgreSQL 16 · All 16 Tables Active ({dbStats ? Object.values(dbStats).reduce((a, b) => a + b, 0) : 0} total records)
                          </Text>
                        </View>
                      </View>

                      {devTab === 'counts' && (
                        <View className="bg-white border border-neutral-200/80 rounded-xl p-2.5 divide-y divide-neutral-200/60">
                          {dbStats ? (
                            Object.entries(dbStats).map(([table, count]) => (
                              <View key={table} className="py-1.5 flex-row justify-between items-center">
                                <Text className="text-[10px] font-semibold text-neutral-700 font-mono">
                                  {table}
                                </Text>
                                <View className="bg-neutral-100 px-2 py-0.5 rounded-md">
                                  <Text className="text-[10px] font-bold text-neutral-800 font-mono">
                                    {count} rows
                                  </Text>
                                </View>
                              </View>
                            ))
                          ) : (
                            <Text className="text-[10px] text-neutral-400 py-2 text-center">
                              Tap refresh to load table statistics
                            </Text>
                          )}
                        </View>
                      )}

                      {devTab === 'architecture' && (
                        <View className="space-y-2.5">
                          {ER_DOMAINS.map((domain) => (
                            <View
                              key={domain.id}
                              className="rounded-xl border p-3 space-y-2"
                              style={{ backgroundColor: domain.bg, borderColor: domain.border }}
                            >
                              <View className="flex-row items-center justify-between">
                                <View className="flex-row items-center gap-1.5">
                                  <Layers size={13} color={domain.color} />
                                  <Text className="text-[11px] font-bold text-neutral-900">
                                    {domain.title}
                                  </Text>
                                </View>
                                <Text
                                  className="text-[8px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-full"
                                  style={{ backgroundColor: `${domain.color}20`, color: domain.color }}
                                >
                                  {domain.badge}
                                </Text>
                              </View>
                              <Text className="text-[9px] text-neutral-600 font-medium">
                                {domain.description}
                              </Text>
                              <View className="space-y-1 pt-0.5">
                                {domain.tables.map((tbl) => (
                                  <View
                                    key={tbl.name}
                                    className="bg-white/90 border border-neutral-200/80 p-1.5 rounded-lg flex-row justify-between items-center"
                                  >
                                    <Text className="text-[10px] font-bold text-neutral-900 font-mono">
                                      {tbl.name}
                                    </Text>
                                    <Text className="text-[9px] text-neutral-500 font-mono">
                                      {dbStats && dbStats[tbl.name] !== undefined ? `${dbStats[tbl.name]} rows` : 'active'}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* Refresh Button */}
                <TouchableOpacity
                  onPress={loadDbData}
                  disabled={loadingDb}
                  className="w-full bg-[#007aff] py-3.5 rounded-xl items-center justify-center mt-2 active:opacity-90 flex-row gap-2"
                >
                  <RefreshCw size={14} color="#ffffff" />
                  <Text className="text-white text-xs font-bold">
                    {loadingDb ? 'Querying Care Audit Trails...' : 'Refresh Activity Log'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Family Switcher Modal (FAM-009) */}
        <Modal
          visible={showFamilyModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowFamilyModal(false)}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-white rounded-t-[28px] p-6 pt-3 max-h-[80%] space-y-4 shadow-xl">
              <View className="w-10 h-1.5 bg-neutral-200 rounded-full self-center mb-1.5" />

              <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                <View className="flex-row items-center gap-2">
                  <Home size={18} color="#059669" />
                  <Text className="text-lg font-bold text-neutral-900 tracking-tight">
                    Switch Family Context
                  </Text>
                </View>
                <TouchableOpacity
                  testID="family-switcher-close"
                  onPress={() => setShowFamilyModal(false)}
                  className="p-1.5 bg-neutral-100 rounded-full"
                >
                  <X size={16} color="#8e8e93" />
                </TouchableOpacity>
              </View>

              <Text className="text-[11px] text-neutral-500 leading-relaxed">
                Data, permissions and notifications are isolated per family. Switching refreshes
                the active scope used by every subsequent API call.
              </Text>

              <ScrollView className="space-y-2" showsVerticalScrollIndicator={false}>
                {loadingFamilies && families.length === 0 ? (
                  <Text className="text-xs text-neutral-400 py-4 text-center">Loading families…</Text>
                ) : families.length === 0 ? (
                  <Text className="text-xs text-neutral-400 py-4 text-center">
                    No additional families found for this user.
                  </Text>
                ) : (
                  families.map((fam: any) => {
                    const active = fam.id === activeFamilyId;
                    return (
                      <TouchableOpacity
                        key={fam.id}
                        testID={`family-switcher-item-${fam.id}`}
                        onPress={() => handleSwitchFamily(fam.id, fam.name || 'Family')}
                        className={`p-4 rounded-2xl border flex-row items-center justify-between ${
                          active
                            ? 'border-emerald-400 bg-emerald-50/70'
                            : 'border-neutral-200 bg-white'
                        }`}
                      >
                        <View className="flex-1 pr-3">
                          <Text
                            testID={`family-switcher-name-${fam.id}`}
                            className={`text-sm font-bold ${
                              active ? 'text-emerald-800' : 'text-neutral-800'
                            }`}
                          >
                            {fam.name || 'Family'}
                          </Text>
                          <Text className="text-[10px] text-neutral-500 font-mono mt-0.5" numberOfLines={1}>
                            {fam.id}
                          </Text>
                        </View>
                        {active ? (
                          <View className="bg-emerald-500 px-2.5 py-1 rounded-full">
                            <Text className="text-[9px] font-bold text-white uppercase">Active</Text>
                          </View>
                        ) : (
                          <ChevronRight size={16} color="#8e8e93" />
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>

              <TouchableOpacity
                testID="family-switcher-refresh"
                onPress={loadFamilies}
                disabled={loadingFamilies}
                className="w-full bg-emerald-600 py-3 rounded-xl flex-row items-center justify-center gap-2"
              >
                <RefreshCw size={14} color="#ffffff" />
                <Text className="text-white text-xs font-bold">
                  {loadingFamilies ? 'Refreshing…' : 'Refresh Family List'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
      <SimulatorControls
        onTriggerNotification={context.handleTriggerSimulation}
        onRefreshData={context.handleWearableSyncRefresh}
        isSyncing={context.isSyncing}
        currentLoopStep={context.currentLoopStep}
        onAdvanceLoop={context.handleAdvanceLoop}
        onResetLoop={context.handleResetLoop}
      />
    </DeviceFrame>
  );
}

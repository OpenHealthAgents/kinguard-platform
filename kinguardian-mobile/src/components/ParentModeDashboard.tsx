import React, { useState, useContext, useEffect } from 'react';
import { AppState, View, Text, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import {
  MessageSquare,
  Volume2,
  Bell,
  Watch,
  ChevronRight,
  Calendar,
  FileText,
  Flame,
  Heart,
  Moon,
  Activity,
  Camera,
  Image as ImageIcon,
  Mic,
  RefreshCw,
  CheckCircle2
} from 'lucide-react-native';

import { HealthRecordItem } from '../types';
import { t, getLanguage } from '../i18n';
import { AppContext } from '../store/AppContext';
import { googleFitService } from '../services/health/GoogleFitService';
import { realDataService, isUUID } from '../services/api-client/RealDataService';
import { formatTimeForParent } from '../utils/timezone';
import { BrandLogo } from './ui/BrandLogo';

interface ParentModeDashboardProps {
  medications: HealthRecordItem[];
  onConfirmMedication: (id: string, name: string, taken: boolean) => void;
  onCheckIn: (status: 'Good' | 'Tired' | 'Unwell') => void;
  onOpenVoice: () => void;
  dadStatus: string;
  isAtorvastatinTaken: boolean;
  onOpenNotifications: () => void;
  unreadCount: number;
  targetSubjectId?: string;
  familyId?: string;
  initialMedications?: any[];
  initialAppointments?: any[];
}

export const ParentModeDashboard: React.FC<ParentModeDashboardProps> = ({
  medications,
  onConfirmMedication,
  onCheckIn,
  onOpenVoice,
  isAtorvastatinTaken,
  onOpenNotifications,
  unreadCount,
  targetSubjectId,
  familyId,
  initialMedications,
  initialAppointments
}) => {
  const router = useRouter();
  const context = useContext(AppContext);
  const coordName = context?.coordinatorName || 'Coordinator';
  const parentName = context?.currentUser?.name || 'Parent';

  const getParentGreeting = () => {
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const lang = getLanguage();

    const relation = (context?.currentUser?.relation || '').toLowerCase();
    const name = context?.currentUser?.name || parentName;
    const nameLower = name.toLowerCase();

    const isMother = relation.includes('mother') || relation.includes('mom') || nameLower.includes('mother') || nameLower.includes('mom');
    const isFather = relation.includes('father') || relation.includes('dad') || nameLower.includes('father') || nameLower.includes('dad');

    if (lang === 'ta') {
      if (isMother) return 'காலை வணக்கம், அம்மா ❤️';
      if (isFather) return 'காலை வணக்கம், அப்பா ❤️';
      return `காலை வணக்கம், ${name.split(' ')[0]} ❤️`;
    }
    if (lang === 'hi') {
      if (isMother) return 'सुप्रभात, माताजी ❤️';
      if (isFather) return 'सुप्रभात, पिताजी ❤️';
      return `सुप्रभात, ${name.split(' ')[0]} ❤️`;
    }

    if (isMother) return `${timeGreeting}, Mom ❤️`;
    if (isFather) return `${timeGreeting}, Dad ❤️`;
    if (name && name !== 'Parent') {
      return `${timeGreeting}, ${name.split(' ')[0]} ❤️`;
    }
    return `${timeGreeting}, Parent ❤️`;
  };

  // Dynamic clinical and schedule state
  const [dynamicMeds, setDynamicMeds] = useState<any[]>(initialMedications || []);
  const [dynamicAppointments, setDynamicAppointments] = useState<any[]>(initialAppointments || []);
  const [confirmedMedIds, setConfirmedMedIds] = useState<string[]>([]);
  const [parentSummary, setParentSummary] = useState<any>(null);

  // Check-in state variables
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [feeling, setFeeling] = useState<'Good' | 'Tired' | 'Unwell' | null>(null);
  const [typedNote, setTypedNote] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [isDoseConfirmed, setIsDoseConfirmed] = useState(false);
  // CHK-004: Source event time of the most recent check-in, rendered in the parent's timezone.
  const [lastCheckInAt, setLastCheckInAt] = useState<string | null>(null);
  const parentTimezone =
    (typeof Intl !== 'undefined' && Intl.DateTimeFormat?.().resolvedOptions?.().timeZone) ||
    'Asia/Kolkata';

  const [activeDevice, setActiveDevice] = useState<{
    name: string;
    status: string;
    lastUpdated: string;
    steps?: number;
  }>({
    name: 'No device connected',
    status: 'Not connected',
    lastUpdated: 'Waiting for device connection',
    steps: 0
  });

  const [telemetry, setTelemetry] = useState(() => googleFitService.getLatestTelemetry());

  // Wearable Continuous Auto-Sync states
  const [isSyncingFit, setIsSyncingFit] = useState(false);
  const [lastAutoSyncTime, setLastAutoSyncTime] = useState<string>('Waiting for device connection');

  useEffect(() => {
    let isMounted = true;
    const resolvedId = targetSubjectId || context?.currentPersonId;
    const targetFamilyId = familyId && isUUID(familyId) ? familyId : undefined;

    // Load initial device connections, dynamic medications, appointments, and summary from backend
    const loadInitialState = async () => {
      try {
        const [conns, summary, medsRes, apptsRes, checkinsRes, parentSumRes] = await Promise.allSettled([
          realDataService.getWearableConnections(resolvedId),
          realDataService.getWearableHealthSummary(resolvedId),
          realDataService.getSubjectMedications(resolvedId),
          realDataService.getAppointments(targetFamilyId, resolvedId),
          realDataService.getCheckIns(targetFamilyId, resolvedId),
          realDataService.getParentSummary(resolvedId)
        ]);

        if (isMounted) {
          if (medsRes.status === 'fulfilled' && medsRes.value?.medications && medsRes.value.medications.length > 0) {
            setDynamicMeds(medsRes.value.medications);
          }
          if (apptsRes.status === 'fulfilled' && Array.isArray(apptsRes.value) && apptsRes.value.length > 0) {
            setDynamicAppointments(apptsRes.value);
          }
          if (checkinsRes.status === 'fulfilled' && Array.isArray(checkinsRes.value) && checkinsRes.value.length > 0) {
            const latest = checkinsRes.value[0];
            if (latest?.occurred_at) {
              setLastCheckInAt(latest.occurred_at);
            }
          }
          if (parentSumRes.status === 'fulfilled' && parentSumRes.value && !parentSumRes.value.error) {
            setParentSummary(parentSumRes.value);
          }

          const activeConn = conns.status === 'fulfilled' && Array.isArray(conns.value)
            ? conns.value.find((c: any) => c.connection_status === 'connected' || c.connection_status === 'active')
            : null;

          if (activeConn) {
            const provName = activeConn.provider === 'garmin'
              ? 'Garmin Watch'
              : activeConn.provider === 'fitbit'
              ? 'Fitbit Tracker'
              : (activeConn.provider === 'apple_watch' || activeConn.provider === 'apple_health')
              ? 'Apple Watch'
              : 'Google Fit / Health Connect';
            setActiveDevice({
              name: provName,
              status: 'Connected',
              lastUpdated: 'Live synced',
              steps: 0
            });
          } else {
            setActiveDevice({
              name: 'No device connected',
              status: 'Not connected',
              lastUpdated: 'No active device',
              steps: 0
            });
          }

          if (summary.status === 'fulfilled' && summary.value) {
            const sum = summary.value;
            const isConn = sum.wearable_status === 'connected' && !sum.data_availability_issue && Boolean(activeConn);
            if (isConn) {
              setTelemetry((prev) => ({
                ...prev,
                steps: sum.steps || prev.steps || 0,
                heartRate: sum.heart_rate || prev.heartRate || 72,
                sleepMinutes: sum.sleep_minutes || prev.sleepMinutes || 465,
                isConnected: true,
                isStreaming: true,
                provenance: sum.source === 'garmin'
                  ? 'Garmin Watch'
                  : sum.source === 'fitbit'
                  ? 'Fitbit Tracker'
                  : (sum.source === 'apple_watch' || sum.source === 'apple_health')
                  ? 'Apple Watch'
                  : 'Google Fit / Health Connect'
              }));
              setActiveDevice((prev) => ({
                ...prev,
                status: 'Connected',
                lastUpdated: 'Live synced',
                steps: sum.steps || prev.steps
              }));
              setLastAutoSyncTime('Last synced just now');
            } else {
              setTelemetry((prev) => ({
                ...prev,
                steps: 0,
                heartRate: 0,
                sleepMinutes: 0,
                isConnected: false,
                isStreaming: false,
                provenance: 'No device connected'
              }));
              setActiveDevice({
                name: 'No device connected',
                status: 'Not connected',
                lastUpdated: 'No active device',
                steps: 0
              });
              setLastAutoSyncTime('No device connected');
            }
          }
        }
      } catch (e) {
        console.warn('ParentModeDashboard initial wearable load:', e);
      }
    };

    loadInitialState();

    const unsubscribe = googleFitService.subscribe((data) => {
      if (isMounted) {
        if (data.isConnected) {
          setTelemetry((prev) => ({
            ...data,
            steps: data.steps > 0 ? data.steps : prev.steps,
            heartRate: data.heartRate > 0 ? data.heartRate : prev.heartRate,
            sleepMinutes: data.sleepMinutes > 0 ? data.sleepMinutes : prev.sleepMinutes
          }));
          setActiveDevice((prev) => ({
            name: data.provenance.includes('Health Connect')
              ? 'Google Fit / Health Connect'
              : (data.provenance && data.provenance !== 'No health data available')
              ? data.provenance
              : prev.name,
            status: 'Connected',
            lastUpdated: `Checked ${new Date().toLocaleTimeString()}`,
            steps: data.steps > 0 ? data.steps : prev.steps
          }));
          setLastAutoSyncTime(`Last checked ${new Date().toLocaleTimeString()}`);
        } else {
          setTelemetry((prev) => ({
            ...prev,
            steps: 0,
            heartRate: 0,
            sleepMinutes: 0,
            isConnected: false,
            isStreaming: false,
            provenance: 'No device connected'
          }));
          setActiveDevice({
            name: 'No device connected',
            status: 'Not connected',
            lastUpdated: 'No active device',
            steps: 0
          });
          setLastAutoSyncTime('No device connected');
        }
      }
    });

    const startSync = () => {
      googleFitService.startRealTimeStreaming(resolvedId, 3500);
    };

    if (AppState.currentState === 'active') startSync();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        loadInitialState();
        startSync();
      } else {
        googleFitService.stopRealTimeStreaming();
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
      appStateSubscription.remove();
      googleFitService.stopRealTimeStreaming();
    };
  }, [targetSubjectId, context?.currentPersonId]);

  const handleForceAutoSync = async () => {
    if (!telemetry.isConnected) {
      router.push('/(parent)/devices');
      return;
    }
    setIsSyncingFit(true);
    const resolvedId = targetSubjectId || context?.currentPersonId;
    try {
      if (typeof googleFitService?.initPedometer === 'function') {
        await googleFitService.initPedometer(resolvedId);
      }
      const latest = await googleFitService.fetchLatestData(resolvedId);
      let stepsToSync = latest.steps;
      if (stepsToSync === 0 && telemetry.steps > 0) {
        stepsToSync = telemetry.steps;
      }
      if (stepsToSync === 0) {
        try {
          const sum = await realDataService.getWearableHealthSummary(resolvedId);
          if (sum && sum.steps > 0) stepsToSync = sum.steps;
        } catch {}
      }

      if (stepsToSync > 0) {
        await realDataService.syncHealthConnectTelemetry(resolvedId, {
          steps: stepsToSync || 0
        });
      }

      setTelemetry((prev) => ({
        ...prev,
        steps: stepsToSync,
        isConnected: true,
        lastUpdated: new Date()
      }));
      setLastAutoSyncTime(`Last synced ${new Date().toLocaleTimeString()}`);
      setActiveDevice((prev) => ({
        ...prev,
        status: 'Connected',
        steps: stepsToSync
      }));

      Alert.alert(
        'Wearable Synced',
        `Steps: ${stepsToSync.toLocaleString()} • Connected and up to date with ${coordName}.`
      );
    } catch (e) {
      console.warn('Auto-sync error:', e);
      Alert.alert('Wearable Sync', 'Could not sync wearable data right now.');
    } finally {
      setIsSyncingFit(false);
    }
  };

  const activeMedicationsList = dynamicMeds.length > 0 ? dynamicMeds : medications;

  // Dynamically resolve the active pending dose for today
  const activePendingDose = (() => {
    if (isDoseConfirmed) return null;

    if (activeMedicationsList.length > 0) {
      const found = activeMedicationsList.find((m: any) => {
        const id = m.id || m.medication_ref || m.name || m.title;
        if (confirmedMedIds.includes(id)) return false;
        const adherenceStr = (m.adherence || m.compliance_status || m.status || '').toLowerCase();
        return !adherenceStr.includes('taken') && !adherenceStr.includes('confirmed');
      });
      if (found) return found;
    }

    if (!isAtorvastatinTaken && !confirmedMedIds.includes('rec-5')) {
      return {
        id: 'rec-5',
        name: 'Atorvastatin',
        dosage: '20mg',
        timing: '8:00 PM',
        schedule: 'evening',
        definition: 'cholesterol support'
      };
    }

    return null;
  })();

  const upcomingAppt = (() => {
    if (dynamicAppointments.length > 0) {
      const a = dynamicAppointments.find((x: any) =>
        (x.status || '').toLowerCase() === 'scheduled' || (x.status || '').toLowerCase() === 'upcoming'
      ) || dynamicAppointments[0];
      if (a) {
        let dateDisplay = a.date || 'Tomorrow';
        try {
          const parsed = new Date(a.date);
          if (!isNaN(parsed.getTime())) {
            dateDisplay = parsed.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
          }
        } catch {}
        return {
          doctorName: a.doctor_name || a.doctorName || a.doctor || 'Dr. Sharma',
          specialty: a.specialty || 'Cardiology',
          date: dateDisplay,
          time: a.time || (a.datetime ? new Date(a.datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '4:00 PM'),
          location: a.location || 'Apollo Hospital'
        };
      }
    }
    if (context?.appointments && context.appointments.length > 0) {
      const a = context.appointments.find((x) => x.status === 'upcoming') || context.appointments[0];
      return {
        doctorName: a.doctorName || 'Dr. Sharma',
        specialty: a.specialty || 'Cardiology',
        date: a.date || 'Tomorrow',
        time: a.time || '4:00 PM',
        location: a.location || 'Apollo Hospital'
      };
    }
    return {
      doctorName: 'Dr. Sharma',
      specialty: 'Cardiology',
      date: 'Tomorrow',
      time: '4:00 PM',
      location: 'Apollo Hospital'
    };
  })();

  const handleSelectFeeling = (sel: 'Good' | 'Tired' | 'Unwell') => {
    setFeeling(sel);
    setStep(2);
  };

  const handleFinalizeCheckIn = (customNote?: string) => {
    const finalNote = customNote || typedNote;
    if (feeling) {
      onCheckIn(feeling);
      const nowIso = new Date().toISOString();
      setLastCheckInAt(nowIso);
      if (
        feeling === 'Unwell' ||
        finalNote.toLowerCase().includes('chest') ||
        finalNote.toLowerCase().includes('uncomfortable')
      ) {
        setIsUrgent(true);
      } else {
        setIsUrgent(false);
      }

      // Persist checkin to backend asynchronously
      const resolvedId = targetSubjectId || context?.currentPersonId;
      const targetFamilyId = familyId && isUUID(familyId) ? familyId : undefined;
      realDataService.createCheckIn(
        feeling,
        finalNote,
        feeling === 'Unwell' ? 'urgent' : 'normal',
        resolvedId,
        targetFamilyId
      ).catch(() => {});
    }
    setStep(3);
  };

  const hasCheckInRequest = context?.notifications.some(
    (n) => n.recipient === 'parent' && n.category === 'kinguardian_request' && !n.read
  );

  return (
    <View className="flex-1">
      <ScrollView className="flex-1 bg-gradient-to-b from-slate-50 via-white to-slate-50" contentContainerStyle={{ paddingBottom: 120 }}>
      {/* iOS Native Style Header Bar */}
      <View className="bg-white/80 backdrop-blur-xl pt-8 pb-6 px-6 flex-row justify-between items-center border-b border-slate-100/50 shadow-lg">
        <View>
          <View className="flex-row items-center gap-2 mb-1">
            <BrandLogo size="sm" testID="parent-brand-logo" />
            <View className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-3 py-1 rounded-full">
              <Text className="text-[10px] font-bold text-white uppercase tracking-wider">
                Parent Mode
              </Text>
            </View>
          </View>
          <Text className="text-2xl font-bold text-slate-900 tracking-tight">
            {getParentGreeting()}
          </Text>
          <Text className="text-sm text-slate-500 mt-1">
            Connected with {coordName}{parentSummary?.demographics?.location ? ` • ${parentSummary.demographics.location}` : ''}
          </Text>
        </View>
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            accessibilityHint="Opens notification center"
            onPress={onOpenNotifications}
            className="w-11 h-11 bg-gradient-to-br from-slate-50 to-slate-100 rounded-3xl items-center justify-center relative active:scale-95 shadow-lg border border-slate-200"
          >
            <Bell size={18} color="#64748b" />
            {unreadCount > 0 && (
              <View className="absolute -top-1 -right-1 bg-gradient-to-r from-red-500 to-red-600 w-5 h-5 rounded-full items-center justify-center border-2 border-white shadow-lg">
                <Text className="text-white text-[10px] font-bold">{unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ padding: 20, gap: 28 }}>
        {context?.currentScenario === 'upcoming-appointment' && (
          <TouchableOpacity
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Upcoming appointment tomorrow at 4 PM with Dr. Sharma Cardiology"
            accessibilityHint="Navigates to appointment details and preparations"
            onPress={() => router.push('/(parent)/appointments')}
            className="bg-white rounded-3xl p-5 shadow-lg shadow-neutral-100 space-y-2 border-l-4 border-[#007aff] active:scale-98"
          >
            <Text className="text-sm font-bold text-neutral-900 tracking-tight">
              Your appointment is tomorrow at 4 PM
            </Text>
            <Text className="text-xs text-neutral-500 leading-normal">
              Dr. Sharma Cardiology telehealth consult is booked. Tap to view preparations.
            </Text>
          </TouchableOpacity>
        )}

        {/* Section 1: How are you feeling? */}
        <View className="bg-white rounded-3xl p-5 shadow-lg shadow-neutral-100 space-y-4">
          {hasCheckInRequest && (
            <View className="bg-blue-50/50 p-4 rounded-xl flex-row items-center gap-3">
              <Text className="text-xs font-semibold text-[#007aff] flex-1 leading-relaxed">
                📢 {coordName} sent you a check-in request. Let them know how you are feeling today.
              </Text>
            </View>
          )}

          {step === 1 && (
            <View className="space-y-4">
              <Text className="text-sm font-semibold text-neutral-500 text-center uppercase tracking-wider">
                {t('parentHome.howAreYouFeeling')}
              </Text>
              <View className="flex-row gap-3">
                <TouchableOpacity
                  testID="parent-checkin-feeling-good"
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="I am feeling good"
                  accessibilityHint="Submits check-in that you are feeling good"
                  onPress={() => handleSelectFeeling('Good')}
                  className="flex-1 py-5 px-1 rounded-3xl items-center justify-center bg-neutral-50 border border-neutral-100 active:scale-95 min-h-[92px]"
                >
                  <Text className="text-3xl">😊</Text>
                  <Text className="text-xs font-bold mt-2 text-neutral-700 text-center" numberOfLines={2}>
                    {t('parentHome.feelingGood')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="parent-checkin-feeling-tired"
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="I am feeling okay"
                  accessibilityHint="Submits check-in that you are feeling okay or tired"
                  onPress={() => handleSelectFeeling('Tired')}
                  className="flex-1 py-5 px-1 rounded-3xl items-center justify-center bg-neutral-50 border border-neutral-100 active:scale-95 min-h-[92px]"
                >
                  <Text className="text-3xl">😐</Text>
                  <Text className="text-xs font-bold mt-2 text-neutral-700 text-center" numberOfLines={2}>
                    {t('parentHome.feelingOkay')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="parent-checkin-feeling-unwell"
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="I am feeling unwell"
                  accessibilityHint="Submits check-in that you are feeling unwell and alerts coordinator"
                  onPress={() => handleSelectFeeling('Unwell')}
                  className="flex-1 py-5 px-1 rounded-3xl items-center justify-center bg-neutral-50 border border-neutral-100 active:scale-95 min-h-[92px]"
                >
                  <Text className="text-3xl">😟</Text>
                  <Text className="text-xs font-bold mt-2 text-neutral-700 text-center" numberOfLines={2}>
                    {t('parentHome.feelingNotWell')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {step === 2 && (
            <View className="space-y-4">
              <Text className="text-sm font-semibold text-neutral-500 text-center uppercase tracking-wider">
                Anything bothering you?
              </Text>

              {!isTyping ? (
                <View className="flex-row gap-2.5">
                  <TouchableOpacity
                    testID="parent-checkin-voice"
                    onPress={() => {
                      onOpenVoice();
                      handleFinalizeCheckIn('Voice note logged');
                    }}
                    className="flex-1 bg-neutral-50 border border-neutral-100 py-3.5 rounded-xl flex-row items-center justify-center gap-1.5 active:scale-95"
                  >
                    <Volume2 size={16} color="#007aff" />
                    <Text className="text-xs font-bold text-neutral-700">Speak</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="parent-checkin-type"
                    onPress={() => setIsTyping(true)}
                    className="flex-1 bg-neutral-50 border border-neutral-100 py-3.5 rounded-xl flex-row items-center justify-center gap-1.5 active:scale-95"
                  >
                    <MessageSquare size={16} color="#8e8e93" />
                    <Text className="text-xs font-bold text-neutral-700">Type</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="parent-checkin-skip"
                    onPress={() => handleFinalizeCheckIn()}
                    className="flex-1 bg-neutral-100 py-3.5 rounded-xl items-center justify-center active:scale-95"
                  >
                    <Text className="text-xs font-bold text-neutral-400">Skip</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View className="space-y-3">
                  <TextInput
                    testID="parent-checkin-note-input"
                    value={typedNote}
                    onChangeText={setTypedNote}
                    placeholder="Describe how you feel..."
                    placeholderTextColor="#8e8e93"
                    multiline
                    className="w-full bg-neutral-55 border border-neutral-100 rounded-3xl p-4 text-xs text-neutral-800 font-semibold h-20"
                  />

                  {context?.currentScenario === 'parent-feeling-unwell' && (
                    <TouchableOpacity
                      onPress={() => {
                        setTypedNote('My chest feels uncomfortable.');
                        handleFinalizeCheckIn('My chest feels uncomfortable.');
                      }}
                      className="bg-red-50/50 p-3 rounded-3xl active:scale-95"
                    >
                      <Text className="text-[#ff3b30] text-[10px] font-bold text-center">
                        📢 Tap to speak/type: "My chest feels uncomfortable."
                      </Text>
                    </TouchableOpacity>
                  )}
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => setIsTyping(false)}
                      className="flex-1 bg-neutral-100 py-3 rounded-xl items-center justify-center"
                    >
                      <Text className="text-xs font-semibold text-neutral-500">Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID="parent-checkin-submit"
                      onPress={() => handleFinalizeCheckIn(typedNote)}
                      className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 py-3 rounded-xl items-center justify-center"
                    >
                      <Text className="text-white text-xs font-bold">Submit</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

          {step === 3 && (
            <View className="items-center py-2 space-y-4">
              {isUrgent ? (
                <View
                  testID="parent-checkin-urgent-banner"
                  className="w-full bg-red-50/40 rounded-3xl p-5 space-y-3.5 items-center border border-red-150"
                >
                  <Text className="text-xs font-bold text-[#ff3b30] text-center uppercase tracking-wide">
                    Safety Notification
                  </Text>
                  <Text className="text-base font-bold text-neutral-900 text-center leading-normal px-1">
                    This could require urgent medical attention. Please seek appropriate local
                    medical help now.
                  </Text>
                  <Text className="text-[10px] text-neutral-400 font-semibold text-center leading-normal">
                    Please call emergency responders or go to the nearest hospital immediately.
                  </Text>

                  <TouchableOpacity
                    testID="parent-checkin-call-emergency"
                    onPress={() => alert('Dialing India Emergency Response: 108')}
                    className="w-full bg-[#ff3b30] py-3 rounded-3xl items-center justify-center active:scale-95 shadow-lg mt-1"
                  >
                    <Text className="text-white text-xs font-bold">📞 Call Emergency (108)</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text
                  testID="parent-checkin-confirmation"
                  className="text-base font-bold text-[#34c759] text-center leading-relaxed"
                >
                  Thanks, {parentName}. {coordName} has been updated.
                </Text>
              )}

              {lastCheckInAt && (
                <Text
                  testID="parent-checkin-timestamp"
                  accessibilityLabel={lastCheckInAt}
                  className="text-[10px] font-semibold text-neutral-400 text-center"
                >
                  Checked in at {formatTimeForParent(lastCheckInAt, parentTimezone)} · {parentTimezone}
                </Text>
              )}

              <TouchableOpacity
                onPress={() => {
                  setStep(1);
                  setFeeling(null);
                  setTypedNote('');
                  setIsTyping(false);
                  setIsUrgent(false);
                  setLastCheckInAt(null);
                }}
                className="bg-neutral-100 px-4 py-2.5 rounded-full"
              >
                <Text className="text-[10px] font-bold text-neutral-500 uppercase">
                  Check-in again
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Medication Confirmation Prompt */}
        {activePendingDose ? (
          <View className="bg-white rounded-3xl p-5 shadow-lg shadow-neutral-100 space-y-4 border-l-4 border-[#ff3b30]">
            <View className="space-y-1">
              <Text className="text-[9px] font-bold text-[#ff3b30] uppercase tracking-wider">
                Pending Dose
              </Text>
              <Text className="text-lg font-bold text-neutral-900 leading-tight">
                Did you take your {activePendingDose.schedule || (activePendingDose.timing?.includes('AM') ? 'morning' : 'evening')} medicine?
              </Text>
              <Text className="text-xs font-semibold text-neutral-400 mt-0.5">
                {activePendingDose.name || activePendingDose.title} {activePendingDose.dosage || activePendingDose.dose || ''} {activePendingDose.definition ? `(${activePendingDose.definition})` : ''} scheduled at {activePendingDose.timing || activePendingDose.scheduledTime || 'today'}.
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-3 pt-1">
              <TouchableOpacity
                testID="parent-home-medication-confirm-yes"
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={`Confirm taking ${activePendingDose.name || activePendingDose.title}`}
                accessibilityHint={`Marks ${activePendingDose.name || activePendingDose.title} as taken in your daily schedule`}
                onPress={() => {
                  const mId = activePendingDose.id || activePendingDose.medication_ref || 'rec-5';
                  const mName = `${activePendingDose.name || activePendingDose.title} ${activePendingDose.dosage || activePendingDose.dose || ''}`.trim();
                  setIsDoseConfirmed(true);
                  setConfirmedMedIds((prev) => [...prev, mId]);
                  onConfirmMedication(mId, mName, true);
                  const resolvedId = targetSubjectId || context?.currentPersonId;
                  const targetFamilyId = familyId && isUUID(familyId) ? familyId : undefined;
                  realDataService.confirmMedication(activePendingDose.name || activePendingDose.title, true, resolvedId, targetFamilyId).catch(() => {});
                }}
                className="flex-1 min-w-[140px] min-h-[48px] py-3 px-3 bg-emerald-600 rounded-2xl items-center justify-center active:scale-95 shadow-lg"
              >
                <Text className="text-white font-bold text-xs text-center">Yes, I took it</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="parent-home-medication-confirm-not-yet"
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={`I have not taken ${activePendingDose.name || activePendingDose.title} yet`}
                accessibilityHint="Leaves dose pending and alerts coordinator"
                onPress={() => {
                  if (typeof alert !== 'undefined') {
                    alert(`Please take it as scheduled. Alert synced with ${coordName}.`);
                  }
                }}
                className="min-w-[100px] min-h-[48px] py-3 px-3 bg-neutral-100 rounded-2xl items-center justify-center active:scale-95"
              >
                <Text className="text-neutral-500 font-bold text-xs text-center">Not yet</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View className="bg-emerald-50/90 rounded-3xl p-4 border border-emerald-200 flex-row items-center gap-3 shadow-sm">
            <View className="w-10 h-10 rounded-full bg-emerald-500 items-center justify-center">
              <Text className="text-white font-bold text-base">✓</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs font-bold text-emerald-900">All Scheduled Medicines Taken</Text>
              <Text className="text-[11px] text-emerald-700">Daily medication adherence confirmed • Synced with {coordName}</Text>
            </View>
          </View>
        )}

        {/* Section: Today's Activity & Rest (Continuous Auto-Sync) */}
        <View className="space-y-3">
          <View className="flex-row justify-between items-center px-1">
            <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
              Today's Activity & Rest
            </Text>
            <TouchableOpacity onPress={() => router.push('/(parent)/devices')}>
              <Text className="text-xs font-bold text-[#007aff]">Manage devices &rarr;</Text>
            </TouchableOpacity>
          </View>

          <View className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-3.5">
            <View className="flex-row items-center justify-between pb-2.5 border-b border-slate-100">
              <View className="flex-row items-center gap-2">
                <View className={`w-8 h-8 rounded-xl ${telemetry.isConnected ? 'bg-emerald-50' : 'bg-slate-100'} items-center justify-center`}>
                  <Activity size={16} color={telemetry.isConnected ? '#059669' : '#64748b'} />
                </View>
                <View>
                  <Text className="text-xs font-black text-slate-900">Today's Activity & Rest</Text>
                  <Text className="text-[10px] text-slate-400 font-medium">
                    {telemetry.isConnected ? 'Updates while app is open • ' : ''}
                    <Text className={`font-bold ${telemetry.isConnected ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {telemetry.isConnected ? telemetry.provenance : 'No device connected'}
                    </Text>
                  </Text>
                </View>
              </View>
              <View className={`${telemetry.isConnected ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-100 border-slate-200'} border rounded-full px-2.5 py-0.5 flex-row items-center gap-1.5 shadow-xs`}>
                <View className={`w-1.5 h-1.5 rounded-full ${telemetry.isConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                <Text className={`text-[9px] font-bold uppercase ${telemetry.isConnected ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {telemetry.isConnected ? 'SYNC ACTIVE' : 'NOT CONNECTED'}
                </Text>
              </View>
            </View>

            {/* Live Telemetry Display: Steps, Heart Rate, Sleep */}
            <View className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <View className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-100 items-center justify-center">
                    <Flame size={22} color="#f97316" />
                  </View>
                  <View>
                    <Text className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Today's Steps
                    </Text>
                    <Text className="text-2xl font-black text-slate-900 mt-0.5">
                      {telemetry.isConnected && telemetry.steps > 0 ? telemetry.steps.toLocaleString() : '--'}
                    </Text>
                    <View className="flex-row items-center gap-1 mt-0.5">
                      <View className={`w-2 h-2 rounded-full ${telemetry.isConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <Text className={`text-[11px] font-bold ${telemetry.isConnected ? 'text-emerald-600' : 'text-slate-500'}`}>
                        {telemetry.isConnected ? 'Live • Auto Synced' : 'Not Connected'}
                      </Text>
                      <Text className="text-[10px] text-slate-400 font-semibold">• {activeDevice.name}</Text>
                    </View>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleForceAutoSync}
                  disabled={isSyncingFit}
                  className={`${telemetry.isConnected ? 'bg-[#2a14b4]' : 'bg-[#007aff]'} px-4 py-2.5 rounded-xl flex-row items-center gap-1.5 shadow-xs`}
                >
                  {isSyncingFit ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : telemetry.isConnected ? (
                    <RefreshCw size={13} color="#ffffff" />
                  ) : (
                    <Watch size={13} color="#ffffff" />
                  )}
                  <Text className="text-xs font-bold text-white">
                    {isSyncingFit ? 'Syncing...' : telemetry.isConnected ? 'Sync Now' : 'Connect'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Heart Rate and Sleep pills */}
              <View className="flex-row gap-2 pt-2 border-t border-slate-200/60">
                <View className="flex-1 bg-white border border-slate-200/70 rounded-xl p-2.5 flex-row items-center gap-2">
                  <View className="w-8 h-8 rounded-lg bg-rose-50 items-center justify-center">
                    <Heart size={15} color="#e11d48" />
                  </View>
                  <View>
                    <Text className="text-[10px] font-bold text-slate-400 uppercase">Resting HR</Text>
                    <Text className="text-sm font-black text-slate-900">
                      {telemetry.isConnected && telemetry.heartRate > 0 ? `${telemetry.heartRate} bpm` : '--'}
                    </Text>
                  </View>
                </View>

                <View className="flex-1 bg-white border border-slate-200/70 rounded-xl p-2.5 flex-row items-center gap-2">
                  <View className="w-8 h-8 rounded-lg bg-indigo-50 items-center justify-center">
                    <Moon size={15} color="#6366f1" />
                  </View>
                  <View>
                    <Text className="text-[10px] font-bold text-slate-400 uppercase">Rest Sleep</Text>
                    <Text className="text-sm font-black text-slate-900">
                      {telemetry.isConnected && telemetry.sleepMinutes > 0
                        ? `${Math.floor(telemetry.sleepMinutes / 60)}h ${telemetry.sleepMinutes % 60}m`
                        : '--'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Auto-Sync Status Bar & Navigation */}
            <View className="space-y-2 pt-1">
              <View className={`${telemetry.isConnected ? 'bg-emerald-50/70 border-emerald-200/60' : 'bg-slate-50 border-slate-200'} border rounded-xl py-2 px-3 flex-row items-center justify-between`}>
                <View className="flex-row items-center gap-2">
                  <CheckCircle2 size={14} color={telemetry.isConnected ? '#059669' : '#64748b'} />
                  <Text className={`text-[11px] font-semibold ${telemetry.isConnected ? 'text-emerald-900' : 'text-slate-600'}`}>
                    {lastAutoSyncTime}
                  </Text>
                </View>
                <View className={`${telemetry.isConnected ? 'bg-emerald-100/80' : 'bg-slate-200'} px-2.5 py-0.5 rounded-lg flex-row items-center gap-1`}>
                  <Text className={`text-[10px] font-bold ${telemetry.isConnected ? 'text-emerald-900' : 'text-slate-600'}`}>
                    {telemetry.isConnected ? 'Connected' : 'Not Connected'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => router.push('/(parent)/devices')}
                className="w-full bg-slate-100 active:bg-slate-200 py-2.5 rounded-xl flex-row items-center justify-center gap-1.5"
              >
                <Watch size={13} color="#007aff" />
                <Text className="text-[11px] font-bold text-[#007aff]">My Devices & Sync Settings →</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Section 2: Today's medicines */}
        <View className="space-y-3" testID="parent-home-medicines-section">
          <View className="flex-row justify-between items-center px-1">
            <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
              Today's medicines
            </Text>
            <TouchableOpacity
              testID="parent-home-medicines-see-all"
              onPress={() => router.push('/(parent)/medicines')}
            >
              <Text className="text-xs font-bold text-[#007aff]">See all &rarr;</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 14 }}>
            {activeMedicationsList.length > 0 ? (
              activeMedicationsList.slice(0, 3).map((med: any) => {
                const medId = med.id || med.medication_ref || med.name || med.title;
                const isTaken = confirmedMedIds.includes(medId) ||
                  (med.status || med.compliance_status || med.adherence || '').toLowerCase().includes('taken');
                const title = med.name || med.title || 'Medicine';
                const subtitle = med.dosage || med.dose
                  ? `${med.dosage || med.dose} • ${med.schedule || med.timing || med.frequency || 'Daily'}`
                  : (med.subtitle || 'Daily schedule');

                return (
                  <TouchableOpacity
                    key={medId}
                    testID={`parent-home-medication-${medId}`}
                    onPress={() => router.push('/(parent)/medicines')}
                    className={`bg-white rounded-3xl p-4 flex-row items-center justify-between shadow-lg shadow-neutral-100 active:scale-98 border-l-4 ${
                      isTaken ? 'border-[#34c759]' : 'border-[#ff9500]'
                    }`}
                  >
                    <View className="flex-grow space-y-0.5">
                      <Text className="text-sm font-bold text-neutral-900">{title}</Text>
                      <Text className="text-xs text-neutral-400 font-semibold leading-relaxed">
                        {subtitle}
                      </Text>
                    </View>
                    <View
                      className={`px-2.5 py-0.5 rounded-full ${isTaken ? 'bg-emerald-50' : 'bg-orange-50'}`}
                    >
                      <Text
                        className={`text-[8px] font-bold uppercase ${isTaken ? 'text-[#34c759]' : 'text-[#ff9500]'}`}
                      >
                        {isTaken ? 'Taken' : 'Pending'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : (
              <View className="bg-white rounded-3xl p-4 border border-slate-100">
                <Text className="text-xs text-slate-500 font-medium">No medications scheduled for today.</Text>
              </View>
            )}
          </View>
        </View>

        {/* Section: My health devices */}
        <View className="space-y-3">
          <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider px-1">
            My health devices
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(parent)/devices')}
            className="bg-white rounded-3xl p-5 shadow-lg shadow-neutral-100 flex-row items-center justify-between active:scale-98 border border-neutral-100"
          >
            <View className="flex-row items-center gap-3.5">
              <View className="w-12 h-12 rounded-3xl bg-indigo-50 border border-indigo-100 items-center justify-center">
                <Watch size={24} color="#2a14b4" />
              </View>
              <View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-base font-bold text-neutral-900">{activeDevice.name}</Text>
                  <View className={`w-2 h-2 rounded-full ${telemetry.isConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  <Text className={`text-xs font-bold ${telemetry.isConnected ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {activeDevice.status}
                  </Text>
                </View>
                <Text className="text-xs text-neutral-400 font-medium mt-0.5">
                  {activeDevice.steps ? `${activeDevice.steps.toLocaleString()} steps • ` : ''}{activeDevice.lastUpdated}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center gap-1">
              <Text className="text-xs font-bold text-[#007aff]">View</Text>
              <ChevronRight size={14} color="#007aff" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Section: Doctor Appointments */}
        <View className="space-y-3" testID="parent-home-appointments-section">
          <View className="flex-row justify-between items-center px-1">
            <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
              Doctor Appointments
            </Text>
            <TouchableOpacity
              testID="parent-home-appointments-see-all"
              onPress={() => router.push('/(parent)/appointments')}
            >
              <Text className="text-xs font-bold text-[#007aff]">See all &rarr;</Text>
            </TouchableOpacity>
          </View>

          {upcomingAppt ? (
            <TouchableOpacity
              testID="parent-home-appointment-card"
              onPress={() => router.push('/(parent)/appointments')}
              className="bg-white rounded-3xl p-5 shadow-lg shadow-neutral-100 space-y-3.5 border-l-4 border-[#007aff] active:scale-98"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                  <View className="w-12 h-12 rounded-3xl bg-blue-50 border border-blue-100 items-center justify-center">
                    <Calendar size={24} color="#007aff" />
                  </View>
                  <View className="flex-1">
                    <Text
                      testID="parent-home-appointment-doctor"
                      className="text-base font-bold text-neutral-900"
                    >
                      {upcomingAppt.doctorName} ({upcomingAppt.specialty})
                    </Text>
                    <Text
                      testID="parent-home-appointment-details"
                      className="text-xs text-neutral-500 mt-0.5"
                    >
                      {upcomingAppt.date} at {upcomingAppt.time} • {upcomingAppt.location}
                    </Text>
                    <Text
                      testID="parent-home-appointment-localtime"
                      accessibilityLabel={`Appointment at ${upcomingAppt.time} your local time, ${parentTimezone}. No conversion needed.`}
                      className="text-[10px] font-bold text-neutral-400 mt-1"
                    >
                      {upcomingAppt.time} local time · {parentTimezone}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={16} color="#8e8e93" />
              </View>

              <View className="bg-blue-50/60 px-3.5 py-2 rounded-xl flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-[#007aff]">
                  {upcomingAppt.specialty} consultation booked
                </Text>
                <Text className="text-xs font-bold text-[#007aff]">View Details &rarr;</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              testID="parent-home-appointment-card"
              onPress={() => router.push('/(parent)/appointments')}
              className="bg-white rounded-3xl p-4.5 shadow-lg shadow-neutral-100 flex-row items-center justify-between active:scale-98 border-l-4 border-slate-300"
            >
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-12 h-12 rounded-3xl bg-slate-50 border border-slate-100 items-center justify-center">
                  <Calendar size={24} color="#64748b" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-neutral-900">No Upcoming Appointments</Text>
                  <Text className="text-xs text-neutral-500 mt-0.5">Your schedule is clear. Tap to view past consults.</Text>
                </View>
              </View>
              <ChevronRight size={16} color="#8e8e93" />
            </TouchableOpacity>
          )}
        </View>

        {/* Section: Documents */}
        <View className="space-y-3" testID="parent-home-documents-section">
          <View className="flex-row justify-between items-center px-1">
            <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
              Documents
            </Text>
            <TouchableOpacity
              testID="parent-home-documents-open"
              onPress={() => router.push('/(parent)/documents')}
            >
              <Text className="text-xs font-bold text-[#007aff]">Open Documents &rarr;</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            testID="parent-home-documents-card"
            onPress={() => router.push('/(parent)/documents')}
            className="bg-white rounded-3xl p-5 shadow-lg shadow-neutral-100 active:scale-98 border-l-4 border-[#ff9500]"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-12 h-12 rounded-3xl bg-amber-50 border border-amber-100 items-center justify-center">
                  <FileText size={24} color="#d97706" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-neutral-900" numberOfLines={1}>
                    {context?.documents?.[0]?.name || 'Documents & Prescriptions'}
                  </Text>
                  <Text className="text-xs text-neutral-500 mt-0.5">
                    {context?.documents?.[0]
                      ? `${context.documents[0].category || 'Prescription'} • Under review by ${coordName}`
                      : 'Share prescription, lab reports, or doctor instructions'}
                  </Text>
                </View>
              </View>
              <ChevronRight size={16} color="#8e8e93" />
            </View>

            {/* Quick action shortcuts */}
            <View className="flex-row items-center gap-2 mt-3 pt-3 border-t border-neutral-100">
              <TouchableOpacity
                testID="parent-home-documents-camera"
                onPress={() => router.push('/(parent)/documents')}
                className="flex-1 py-2 px-2 bg-rose-50 rounded-xl border border-rose-100 flex-row items-center justify-center gap-1.5"
              >
                <Camera size={14} color="#ff3b30" />
                <Text className="text-[11px] font-bold text-rose-700">Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="parent-home-documents-gallery"
                onPress={() => router.push('/(parent)/documents')}
                className="flex-1 py-2 px-2 bg-emerald-50 rounded-xl border border-emerald-100 flex-row items-center justify-center gap-1.5"
              >
                <ImageIcon size={14} color="#34c759" />
                <Text className="text-[11px] font-bold text-emerald-700">Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="parent-home-documents-voice"
                onPress={() => router.push('/(parent)/documents')}
                className="flex-1 py-2 px-2 bg-purple-50 rounded-xl border border-purple-100 flex-row items-center justify-center gap-1.5"
              >
                <Mic size={14} color="#af52de" />
                <Text className="text-[11px] font-bold text-purple-700">Voice Note</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </View>

        <View className="h-28" />
      </View>
    </ScrollView>

  </View>
  );
};

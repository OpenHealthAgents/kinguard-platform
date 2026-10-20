import { useContext, useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  User,
  Activity,
  Stethoscope,
  Pill,
  FileText,
  Watch,
  Sparkles,
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  Calendar,
  Phone,
  MessageSquare,
  Flame,
  Heart,
  Moon
} from 'lucide-react-native';
import { AppContext } from '../../../../src/store/AppContext';
import { DeviceFrame } from '../../../../src/components/DeviceFrame';
import { SimulatorControls } from '../../../../src/components/SimulatorControls';
import { Avatar } from '../../../../src/components/ui/Avatar';
import { googleFitService } from '../../../../src/services/health/GoogleFitService';
import { realDataService } from '../../../../src/services/api-client/RealDataService';

export default function ParentClinicalOverviewRoute() {
  const context = useContext(AppContext);
  const router = useRouter();
  const { id } = useLocalSearchParams();

  if (!context) return null;

  const personId = typeof id === 'string' ? id : 'dad';
  const person =
    context.people.find((p) => p.id === personId || p.backendSubjectId === personId || (p as any).profile_id === personId) ||
    context.familyMembers.find((p) => p.id === personId || p.backendSubjectId === personId || (p as any).profile_id === personId) ||
    context.selectedParent ||
    context.people[0] ||
    context.familyMembers[0] ||
    {
      id: personId || 'mom',
      name: 'Jane Doe',
      relation: 'Mother',
      relationship: 'Mother',
      age: 70,
      city: 'Hyderabad',
      country: 'India',
      location: 'Hyderabad, India',
      wellbeingStatus: 'doing-well' as const
    };

  const isDad =
    person.relation?.toLowerCase().includes('father') ||
    person.relationship?.toLowerCase().includes('father');

  const [parentSummary, setParentSummary] = useState<any>(null);
  const [conditionsList, setConditionsList] = useState<any[]>([]);
  const [medicationsList, setMedicationsList] = useState<any[]>([]);
  const [labsList, setLabsList] = useState<any[]>([]);
  const [vitalsData, setVitalsData] = useState<any>(null);

  const [telemetry, setTelemetry] = useState(() => {
    const latest = googleFitService.getLatestTelemetry();
    return {
      steps: latest.steps || 0,
      heartRate: latest.heartRate || 72,
      sleepMinutes: latest.sleepMinutes || 465,
      isStreaming: latest.isStreaming,
      provenance: latest.provenance || 'Google Fit'
    };
  });

  const targetSubjectId =
    person.backendSubjectId ||
    (person as any).subject_id ||
    (person.id && person.id !== 'dad' && person.id !== 'mom' ? person.id : null) ||
    context.people.find((p) => p.backendSubjectId)?.backendSubjectId ||
    person.id;

  useEffect(() => {
    let isMounted = true;
    googleFitService.fetchLatestData(targetSubjectId);
    googleFitService.startRealTimeStreaming(targetSubjectId, 3500);
    const unsubscribe = googleFitService.subscribe((data) => {
      if (isMounted) {
        setTelemetry({
          steps: data.steps,
          heartRate: data.heartRate,
          sleepMinutes: data.sleepMinutes,
          isStreaming: data.isStreaming,
          provenance: data.provenance
        });
      }
    });

    // Fetch dynamic FHIR data concurrently
    Promise.allSettled([
      realDataService.getParentSummary(targetSubjectId),
      realDataService.getSubjectConditions(targetSubjectId),
      realDataService.getSubjectMedications(targetSubjectId),
      realDataService.getSubjectLabs(targetSubjectId),
      realDataService.getSubjectVitals(targetSubjectId)
    ]).then(([sumRes, condRes, medRes, labRes, vitRes]) => {
      if (!isMounted) return;
      if (sumRes.status === 'fulfilled' && sumRes.value && !sumRes.value.error) {
        setParentSummary(sumRes.value);
      }
      if (condRes.status === 'fulfilled' && condRes.value?.conditions) {
        setConditionsList(condRes.value.conditions);
      }
      if (medRes.status === 'fulfilled' && medRes.value?.medications) {
        setMedicationsList(medRes.value.medications);
      }
      if (labRes.status === 'fulfilled' && labRes.value?.reports) {
        setLabsList(labRes.value.reports);
      }
      if (vitRes.status === 'fulfilled' && vitRes.value?.latest_vitals) {
        setVitalsData(vitRes.value.latest_vitals);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
      googleFitService.stopRealTimeStreaming();
    };
  }, [targetSubjectId, person.backendSubjectId, person.id, isDad]);

  // 1. Demographics & Ref parsing
  const parsedRef = (() => {
    const raw = (person as any).external_patient_ref || parentSummary?.external_patient_ref;
    if (!raw) return {};
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return {};
    }
  })();

  const resolvedName = parentSummary?.demographics?.name || person.name || 'Parent';
  const resolvedAge = parsedRef.age || parentSummary?.demographics?.age || person.age || 70;
  const resolvedRelationship = parsedRef.relationship || parentSummary?.demographics?.relationship || person.relationship || person.relation || 'Mother';
  const resolvedCity = person.city && person.city !== 'Not provided' ? person.city : (parsedRef.city || 'Hyderabad');
  const resolvedCountry = person.country && person.country !== 'Not provided' ? person.country : (parsedRef.country || 'India');
  const resolvedLocation = `${resolvedCity}, ${resolvedCountry}`;
  const resolvedMrn = parsedRef.uid
    ? `MRN-${String(parsedRef.uid).toUpperCase()}`
    : (person.backendSubjectId ? `MRN-${String(person.backendSubjectId).slice(0, 8).toUpperCase()}` : 'MRN-812AA854');
  const resolvedClinic = parentSummary?.diagnostic_reports?.[0]?.performer || 'Apollo Hospitals, Jubilee Hills';

  // 2. Vitals (BP, Glucose, HR, Steps, Sleep)
  const displayBP = (() => {
    if (context.currentBP && context.currentBP !== '--') return context.currentBP;
    if (vitalsData?.blood_pressure?.systolic && vitalsData?.blood_pressure?.diastolic) {
      return `${vitalsData.blood_pressure.systolic}/${vitalsData.blood_pressure.diastolic} mmHg`;
    }
    if (parentSummary?.vitals_summary?.blood_pressure) {
      return parentSummary.vitals_summary.blood_pressure;
    }
    if (context.bpHistory && context.bpHistory.length > 0) {
      const latest = context.bpHistory[context.bpHistory.length - 1];
      if (latest?.systolic && latest?.diastolic) {
        return `${latest.systolic}/${latest.diastolic} mmHg`;
      }
    }
    return isDad ? '138/88 mmHg' : '124/82 mmHg';
  })();

  const displayGlucose = (() => {
    if (context.currentGlucose && context.currentGlucose !== '--') return context.currentGlucose;
    if (parentSummary?.vitals_summary?.fasting_glucose) {
      return parentSummary.vitals_summary.fasting_glucose.replace(/\s*mg\/dL/i, '');
    }
    if (context.glucoseHistory && context.glucoseHistory.length > 0) {
      const latest = context.glucoseHistory[context.glucoseHistory.length - 1];
      if (latest?.value) return String(latest.value);
    }
    return isDad ? '104' : '96';
  })();

  const displayHR = telemetry.heartRate > 0
    ? telemetry.heartRate
    : (vitalsData?.heart_rate?.value || (parentSummary?.vitals_summary?.heart_rate ? parseInt(parentSummary.vitals_summary.heart_rate) : 72));

  const displaySteps = telemetry.steps > 0
    ? telemetry.steps
    : (vitalsData?.steps?.value || parentSummary?.vitals_summary?.daily_steps || 3560);

  const displaySleepMinutes = telemetry.sleepMinutes > 0
    ? telemetry.sleepMinutes
    : (parentSummary?.vitals_summary?.sleep_duration ? parseInt(parentSummary.vitals_summary.sleep_duration) : 465);

  const systolicNum = parseInt((displayBP.split('/')[0] || '120').replace(/\D/g, ''), 10);
  const isNeedsAttention = systolicNum >= 140 || person.wellbeingStatus === 'attention';

  // 3. Dynamic Conditions Summary
  const activeConditions = conditionsList.length > 0
    ? conditionsList
    : (parentSummary?.active_conditions || []);
  const conditionsSubtitle = activeConditions.length > 0
    ? activeConditions.map((c: any) => c.display || c.name || c.code).slice(0, 3).join(', ')
    : 'Essential Hypertension, Type 2 Diabetes, Routine Monitoring';

  // 4. Dynamic Medications & Adherence Summary
  const allMeds = medicationsList.length > 0
    ? medicationsList
    : (parentSummary?.medications_summary?.length > 0 ? parentSummary.medications_summary : context.medications);
  const medNames = allMeds.length > 0
    ? allMeds.map((m: any) => m.name || m.display).slice(0, 2).join(', ')
    : 'Amlodipine, Atorvastatin';
  const takenMedsCount = allMeds.filter((m: any) => m.status === 'taken' || m.adherence === '100%' || m.compliance_status === 'taken').length;
  const adherencePercent = allMeds.length > 0 ? Math.round((takenMedsCount / allMeds.length) * 100) : 94;
  const medicationsSubtitle = `${medNames} • ${adherencePercent}% adherence`;

  // 5. Dynamic Lab Reports Summary
  const allLabs = labsList.length > 0
    ? labsList
    : (parentSummary?.diagnostic_reports?.length > 0 ? parentSummary.diagnostic_reports : context.documents);
  const labsSubtitle = allLabs.length > 0
    ? `${allLabs[0].title || allLabs[0].name || 'Comprehensive Metabolic Panel'} • ${allLabs.length} report${allLabs.length > 1 ? 's' : ''} on file`
    : 'Comprehensive Metabolic Panel, Lipid Profile (Apollo)';

  // Resolve caregiver identity from the family data.
  const caregiverMember =
    context.familyMembers.find(
      (m) => m.role === 'caregiver' || m.relationship?.toLowerCase().includes('caregiver') || m.relation?.toLowerCase().includes('caregiver')
    );

  return (
    <DeviceFrame>
      <View className="flex-1 relative bg-[#f8f9fc]">
        {/* Header */}
        <View className="px-5 py-4 border-b border-slate-200/80 bg-white flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.push('/(coordinator)/parents');
                }
              }}
              className="p-2 bg-slate-100 rounded-full active:bg-slate-200"
            >
              <ArrowLeft size={18} color="#1e293b" />
            </TouchableOpacity>
            <View>
              <Text className="text-base font-black text-slate-900 leading-tight">
                {resolvedName}
              </Text>
              <Text className="text-[10px] text-slate-500 font-medium">
                {resolvedMrn} • <Text className="text-blue-600 font-semibold">{resolvedLocation}</Text>
              </Text>
            </View>
          </View>

          <View
            className={`px-2.5 py-1 rounded-full flex-row items-center gap-1 border ${
              isNeedsAttention
                ? 'bg-red-50 border-red-200'
                : 'bg-emerald-50 border-emerald-200'
            }`}
          >
            <View
              className={`w-1.5 h-1.5 rounded-full ${
                isNeedsAttention ? 'bg-red-500' : 'bg-emerald-500'
              }`}
            />
            <Text
              className={`text-[9px] font-black uppercase ${
                isNeedsAttention ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {isNeedsAttention ? 'Attention' : 'Doing Well'}
            </Text>
          </View>
        </View>

        <ScrollView className="flex-1 px-5 pt-4 space-y-4" showsVerticalScrollIndicator={false}>
          {/* Parent Summary Card */}
          <View className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4">
            <View className="flex-row items-center gap-3.5">
              <Avatar
                url={person.avatarUrl}
                name={resolvedName}
                size="xl"
                status="online"
                statusDotColor={isNeedsAttention ? '#ff3b30' : '#34c759'}
              />
              <View className="flex-1">
                <Text className="text-lg font-black text-slate-900">{resolvedName}</Text>
                <Text className="text-xs text-slate-500 font-medium">
                  {resolvedAge} yrs • {resolvedRelationship} • {resolvedLocation}
                </Text>
                <Text className="text-[10px] text-blue-600 font-bold mt-0.5">
                  {resolvedMrn} • {resolvedClinic}
                </Text>
              </View>
            </View>

            {/* Quick Vitals Row */}
            <View className="flex-row gap-2 pt-2 border-t border-slate-100">
              <View className="flex-1 bg-slate-50 p-2.5 rounded-2xl items-center border border-slate-100">
                <Text className="text-[9px] font-bold text-slate-400 uppercase">Blood Pressure</Text>
                <Text className="text-sm font-black text-slate-900 mt-0.5">{displayBP}</Text>
                <Text className="text-[8px] text-emerald-600 font-bold">Latest Sync</Text>
              </View>
              <View className="flex-1 bg-slate-50 p-2.5 rounded-2xl items-center border border-slate-100">
                <Text className="text-[9px] font-bold text-slate-400 uppercase">Glucose</Text>
                <Text className="text-sm font-black text-slate-900 mt-0.5">{displayGlucose} mg/dL</Text>
                <Text className="text-[8px] text-blue-600 font-bold">Fasting</Text>
              </View>
              <View className="flex-1 bg-slate-50 p-2.5 rounded-2xl items-center border border-slate-100">
                <Text className="text-[9px] font-bold text-slate-400 uppercase">Resting HR</Text>
                <Text className="text-sm font-black text-slate-900 mt-0.5">{displayHR} bpm</Text>
                <Text className="text-[8px] text-emerald-600 font-bold">Google Fit Live</Text>
              </View>
            </View>
          </View>

          {/* Google Fit Live Telemetry Card */}
          <View className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-3.5">
            <View className="flex-row items-center justify-between pb-2.5 border-b border-slate-100">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-xl bg-emerald-50 items-center justify-center">
                  <Activity size={16} color="#059669" />
                </View>
                <View>
                  <Text className="text-xs font-black text-slate-900">Google Fit Live Stream</Text>
                  <Text className="text-[10px] text-slate-400 font-medium">
                    Provenance: <Text className="font-bold text-slate-700">{telemetry.provenance}</Text>
                  </Text>
                </View>
              </View>
              <View className="bg-emerald-50 border border-emerald-300 rounded-full px-2.5 py-0.5 flex-row items-center gap-1.5 shadow-xs">
                <View className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <Text className="text-[9px] font-bold text-emerald-700 uppercase">LIVE STREAMING</Text>
              </View>
            </View>

            {/* 3 Live Wearable Metrics */}
            <View className="flex-row gap-2.5">
              <View className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-2.5 items-center">
                <View className="flex-row items-center gap-1 mb-0.5">
                  <Flame size={12} color="#f97316" />
                  <Text className="text-[9px] font-bold text-slate-500 uppercase">Steps</Text>
                </View>
                <Text className="text-base font-black text-slate-900">
                  {displaySteps.toLocaleString()}
                </Text>
                <Text className="text-[9px] text-emerald-600 font-bold mt-0.5">Live Moving</Text>
              </View>

              <View className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-2.5 items-center">
                <View className="flex-row items-center gap-1 mb-0.5">
                  <Heart size={12} color="#e11d48" />
                  <Text className="text-[9px] font-bold text-slate-500 uppercase">Resting HR</Text>
                </View>
                <Text className="text-base font-black text-slate-900">
                  {displayHR} bpm
                </Text>
                <Text className="text-[9px] text-slate-500 font-medium mt-0.5">Real-time</Text>
              </View>

              <View className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-2.5 items-center">
                <View className="flex-row items-center gap-1 mb-0.5">
                  <Moon size={12} color="#6366f1" />
                  <Text className="text-[9px] font-bold text-slate-500 uppercase">Rest Sleep</Text>
                </View>
                <Text className="text-base font-black text-slate-900">
                  {Math.floor(displaySleepMinutes / 60)}h {displaySleepMinutes % 60}m
                </Text>
                <Text className="text-[9px] text-indigo-600 font-bold mt-0.5">
                  {displaySleepMinutes} mins
                </Text>
              </View>
            </View>

            {/* Quick Actions: Manage Wearables */}
            <View className="pt-1">
              <TouchableOpacity
                onPress={() => router.push(`/(coordinator)/parent/${personId}/wearables` as any)}
                className="w-full bg-slate-100 active:bg-slate-200 py-2.5 rounded-xl flex-row items-center justify-center gap-1.5"
              >
                <Watch size={13} color="#007aff" />
                <Text className="text-xs font-bold text-[#007aff]">Wearables & Sync →</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 5 FHIR Clinical Modules */}
          <View className="space-y-2.5">
            <View className="flex-row items-center justify-between px-1">
              <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                FHIR Clinical Modules
              </Text>
              <View className="flex-row items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                <ShieldCheck size={11} color="#007aff" />
                <Text className="text-[9px] font-bold text-blue-700">HL7 FHIR R4</Text>
              </View>
            </View>

            {/* 1. Profile & Identity */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${personId}/profile` as any)}
              className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex-row items-center justify-between active:bg-slate-50"
            >
              <View className="flex-row items-center gap-3 flex-1 pr-2">
                <View className="w-10 h-10 rounded-xl bg-blue-100 items-center justify-center shrink-0">
                  <User size={18} color="#007aff" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-black text-slate-900">FHIR Profile & Identity</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>
                    {resolvedMrn}, Demographics & Care Grants
                  </Text>
                </View>
              </View>
              <ChevronRight size={16} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>

            {/* 2. Vitals */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${personId}/vitals` as any)}
              className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex-row items-center justify-between active:bg-slate-50"
            >
              <View className="flex-row items-center gap-3 flex-1 pr-2">
                <View className="w-10 h-10 rounded-xl bg-rose-100 items-center justify-center shrink-0">
                  <Activity size={18} color="#e11d48" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-black text-slate-900">Vitals & Observations</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>
                    BP {displayBP}, Glucose {displayGlucose} mg/dL & Trends
                  </Text>
                </View>
              </View>
              <ChevronRight size={16} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>

            {/* 3. Conditions */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${personId}/conditions` as any)}
              className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex-row items-center justify-between active:bg-slate-50"
            >
              <View className="flex-row items-center gap-3 flex-1 pr-2">
                <View className="w-10 h-10 rounded-xl bg-indigo-100 items-center justify-center shrink-0">
                  <Stethoscope size={18} color="#4f46e5" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-black text-slate-900">Health Profile & Conditions</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>
                    {conditionsSubtitle}
                  </Text>
                </View>
              </View>
              <ChevronRight size={16} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>

            {/* 4. Medications */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${personId}/medications` as any)}
              className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex-row items-center justify-between active:bg-slate-50"
            >
              <View className="flex-row items-center gap-3 flex-1 pr-2">
                <View className="w-10 h-10 rounded-xl bg-amber-100 items-center justify-center shrink-0">
                  <Pill size={18} color="#d97706" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-black text-slate-900">Medications & Adherence</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>
                    {medicationsSubtitle}
                  </Text>
                </View>
              </View>
              <ChevronRight size={16} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>

            {/* 5. Labs */}
            <TouchableOpacity
              onPress={() => router.push(`/(coordinator)/parent/${personId}/labs` as any)}
              className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex-row items-center justify-between active:bg-slate-50"
            >
              <View className="flex-row items-center gap-3 flex-1 pr-2">
                <View className="w-10 h-10 rounded-xl bg-emerald-100 items-center justify-center shrink-0">
                  <FileText size={18} color="#059669" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-black text-slate-900">Laboratory & Diagnostic Reports</Text>
                  <Text className="text-[10px] text-slate-500 font-medium" numberOfLines={1}>
                    {labsSubtitle}
                  </Text>
                </View>
              </View>
              <ChevronRight size={16} color="#94a3b8" className="shrink-0" />
            </TouchableOpacity>
          </View>

          {/* Quick Actions Grid */}
          <View className="space-y-2.5">
            <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
              Clinical & Care Actions
            </Text>
            <View className="flex-row flex-wrap gap-2.5">
              <TouchableOpacity
                onPress={() => router.push(`/(coordinator)/parent/${personId}/wearables` as any)}
                className="bg-white rounded-2xl p-3.5 flex-1 min-w-[140px] border border-slate-200/80 shadow-xs active:scale-95 space-y-1.5"
              >
                <Watch size={16} color="#007aff" />
                <Text className="text-xs font-black text-slate-900">Wearables & Sync</Text>
                <Text className="text-[9px] text-slate-400 font-medium">Google Fit Live Stream</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push(`/(coordinator)/parent/${personId}/guardian` as any)}
                className="bg-white rounded-2xl p-3.5 flex-1 min-w-[140px] border border-slate-200/80 shadow-xs active:scale-95 space-y-1.5"
              >
                <Sparkles size={16} color="#7c3aed" />
                <Text className="text-xs font-black text-slate-900">Guardian Baseline</Text>
                <Text className="text-[9px] text-slate-400 font-medium">30-Day Physiological Model</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push(`/(coordinator)/parent/${personId}/insights` as any)}
                className="bg-white rounded-2xl p-3.5 flex-1 min-w-[140px] border border-slate-200/80 shadow-xs active:scale-95 space-y-1.5"
              >
                <Activity size={16} color="#e11d48" />
                <Text className="text-xs font-black text-slate-900">AI Transparency</Text>
                <Text className="text-[9px] text-slate-400 font-medium">Telemetry Reasoning</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push(`/(coordinator)/parent/${personId}/prepare` as any)}
                className="bg-white rounded-2xl p-3.5 flex-1 min-w-[140px] border border-slate-200/80 shadow-xs active:scale-95 space-y-1.5"
              >
                <Calendar size={16} color="#d97706" />
                <Text className="text-xs font-black text-slate-900">Doctor Prep</Text>
                <Text className="text-[9px] text-slate-400 font-medium">Questions & Sharing</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push(`/(coordinator)/parent/${personId}/summary` as any)}
                className="bg-rose-50 rounded-2xl p-3.5 w-full border border-rose-200 shadow-xs active:scale-95 flex-row items-center justify-between"
              >
                <View className="flex-row items-center gap-2.5">
                  <AlertTriangle size={18} color="#e11d48" />
                  <View>
                    <Text className="text-xs font-black text-rose-900">Emergency Clinical Summary</Text>
                    <Text className="text-[9px] text-rose-600 font-medium">
                      One-tap clinical sheet for paramedics & ER doctors
                    </Text>
                  </View>
                </View>
                <ChevronRight size={16} color="#e11d48" />
              </TouchableOpacity>
            </View>
          </View>

          {caregiverMember ? (
            <View className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-3 mb-10">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Assigned Local Caregiver
                </Text>
                <TouchableOpacity
                  onPress={() => router.push(`/(coordinator)/caregiver/${caregiverMember.id}` as any)}
                  className="px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200"
                >
                  <Text className="text-[9px] font-bold text-blue-700">View Profile</Text>
                </TouchableOpacity>
              </View>

              <View className="flex-row items-center justify-between pt-1">
                <View className="flex-row items-center gap-3">
                  <Avatar
                    url={caregiverMember.avatarUrl}
                    name={caregiverMember.name}
                    size="md"
                    status="none"
                  />
                  <View>
                    <Text className="text-sm font-bold text-slate-900">{caregiverMember.name}</Text>
                    <Text className="text-[10px] text-slate-500 font-medium">
                      {caregiverMember.relationship || caregiverMember.role}
                      {caregiverMember.city ? ` • ${caregiverMember.city}` : ''}
                    </Text>
                  </View>
                </View>

                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => context.showToast(`Dialing caregiver ${caregiverMember.name}...`)}
                    className="w-9 h-9 rounded-full bg-[#007aff] items-center justify-center active:scale-95 shadow-xs"
                  >
                    <Phone size={15} color="#ffffff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      context.setAskAIQuery(`Ask ${caregiverMember.name} about ${resolvedName}'s status`);
                      context.setAskAIOpen(true);
                      router.push('/(coordinator)/ask');
                    }}
                    className="w-9 h-9 rounded-full bg-slate-100 items-center justify-center active:scale-95"
                  >
                    <MessageSquare size={15} color="#007aff" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            <View className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-3 mb-10">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Caregiver Assignment
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(coordinator)/family' as any)}
                  className="px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200"
                >
                  <Text className="text-[9px] font-bold text-blue-700">Add Member</Text>
                </TouchableOpacity>
              </View>
              <Text className="text-xs text-slate-500 font-medium leading-relaxed">
                No local caregiver assigned yet. Invite a verified caregiver to coordinate daily walks, medication doses, and local check-ins for {resolvedName}.
              </Text>
            </View>
          )}
        </ScrollView>
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

import React, { useState, useEffect, useContext } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { RefreshCw, Clock, Radio, Heart, Activity, User } from 'lucide-react-native';
import { SyncLog } from '../types';
import { AppContext } from '../store/AppContext';
import { googleFitService } from '../services/health/GoogleFitService';

interface SyncDashboardProps {
  syncLogs: SyncLog[];
  onTriggerSync: () => void;
  isSyncing: boolean;
}

export const SyncDashboard: React.FC<SyncDashboardProps> = ({
  syncLogs,
  onTriggerSync,
  isSyncing
}) => {
  const context = useContext(AppContext);

  // 1. DYNAMIC COORDINATOR & PARENT CONTEXT
  const coordMember = (context?.familyMembers || []).find((m) => m.role === 'coordinator');
  const coordName =
    (coordMember as any)?.display_name ||
    context?.coordinatorName ||
    (context?.currentUser?.role === 'coordinator' ? context?.currentUser?.name : null) ||
    context?.currentUser?.name ||
    'Coordinator';

  const parentPerson =
    context?.people?.find(
      (p) => p.id === context?.currentPersonId || p.backendSubjectId === context?.currentPersonId
    ) ||
    context?.people?.find(
      (p) =>
        p.role === 'parent' ||
        p.role === 'subject' ||
        p.relationship?.toLowerCase().includes('father') ||
        p.relationship?.toLowerCase().includes('mother') ||
        p.relationship?.toLowerCase().includes('parent') ||
        p.relation?.toLowerCase().includes('father') ||
        p.relation?.toLowerCase().includes('mother') ||
        p.relation?.toLowerCase().includes('parent')
    ) ||
    context?.selectedParent ||
    context?.people?.[0] ||
    (context?.familyMembers || []).find((m) => m.role === 'parent' || m.role === 'subject');

  const parentName = parentPerson?.name
    ? parentPerson.name.charAt(0).toUpperCase() + parentPerson.name.slice(1)
    : 'Parent';
  const parentRelation = parentPerson?.relationship || parentPerson?.relation || parentPerson?.role || 'Parent';

  // 2. DYNAMIC TIMEZONES & CLOCKS
  const sanitizeLocation = (val?: string | null): string | null => {
    if (!val) return null;
    const trimmed = String(val).trim();
    if (
      !trimmed ||
      trimmed.toLowerCase() === 'not provided' ||
      trimmed.toLowerCase() === 'undefined' ||
      trimmed.toLowerCase() === 'null'
    ) {
      return null;
    }
    return trimmed;
  };

  const coordTimezone =
    (context?.currentUser as any)?.timezone ||
    (coordMember as any)?.timezone ||
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        return 'UTC';
      }
    })();

  const coordCity =
    sanitizeLocation((context?.currentUser as any)?.city) ||
    sanitizeLocation((coordMember as any)?.city) ||
    sanitizeLocation(context?.currentUser?.location?.split(',')?.[0]) ||
    sanitizeLocation(context?.currentUser?.location) ||
    sanitizeLocation((coordMember as any)?.country) ||
    (coordTimezone.includes('/') ? coordTimezone.split('/').pop()?.replace(/_/g, ' ') : null) ||
    'Local';

  const parentTimezone =
    parentPerson?.timezone ||
    (parentPerson?.city ? 'Asia/Kolkata' : coordTimezone) ||
    'Asia/Kolkata';

  const parentCity =
    sanitizeLocation(parentPerson?.city) ||
    sanitizeLocation(parentPerson?.location?.split(',')?.[0]) ||
    sanitizeLocation(parentPerson?.location) ||
    sanitizeLocation(parentPerson?.country) ||
    (parentTimezone.includes('/') ? parentTimezone.split('/').pop()?.replace(/_/g, ' ') : null) ||
    'Parent';

  const [coordTime, setCoordTime] = useState('');
  const [parentTime, setParentTime] = useState('');
  const [coordTzAbbr, setCoordTzAbbr] = useState('');
  const [parentTzAbbr, setParentTzAbbr] = useState('');

  // Calculate live clock & offset
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();

      // Format coordinator clock
      try {
        const cTimeStr = now.toLocaleTimeString('en-US', {
          timeZone: coordTimezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        setCoordTime(cTimeStr);
      } catch {
        setCoordTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }));
      }

      // Format parent clock
      try {
        const pTimeStr = now.toLocaleTimeString('en-US', {
          timeZone: parentTimezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        setParentTime(pTimeStr);
      } catch {
        setParentTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }));
      }

      // Timezone abbreviations
      try {
        const cParts = new Intl.DateTimeFormat('en-US', { timeZone: coordTimezone, timeZoneName: 'short' }).formatToParts(now);
        setCoordTzAbbr(cParts.find((p) => p.type === 'timeZoneName')?.value || '');
      } catch {
        setCoordTzAbbr('');
      }

      try {
        const pParts = new Intl.DateTimeFormat('en-US', { timeZone: parentTimezone, timeZoneName: 'short' }).formatToParts(now);
        setParentTzAbbr(pParts.find((p) => p.type === 'timeZoneName')?.value || '');
      } catch {
        setParentTzAbbr('');
      }
    };

    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, [coordTimezone, parentTimezone]);

  // Calculate dynamic hour difference
  const calculateOffsetHours = (): string => {
    try {
      const now = new Date();
      const d1 = new Date(now.toLocaleString('en-US', { timeZone: coordTimezone })).getTime();
      const d2 = new Date(now.toLocaleString('en-US', { timeZone: parentTimezone })).getTime();
      const diffHours = (d2 - d1) / (1000 * 60 * 60);
      if (isNaN(diffHours) || Math.abs(diffHours) < 0.05) {
        return 'Same Timezone';
      }
      const rounded = Math.round(diffHours * 10) / 10;
      const formattedDiff = Math.abs(rounded) % 1 === 0 ? Math.abs(rounded).toFixed(0) : Math.abs(rounded).toFixed(1);
      return `${formattedDiff} Hour${formattedDiff === '1' ? '' : 's'} ${rounded > 0 ? 'Ahead' : 'Behind'}`;
    } catch {
      return 'Sync Active';
    }
  };

  // 3. DYNAMIC TELEMETRY STREAMS
  const liveTelemetry = googleFitService.getLatestTelemetry();
  const hasLoggedGlucose = Boolean(
    context?.currentGlucose &&
    context.currentGlucose !== '--' &&
    context.currentGlucose !== '-- mg/dL'
  );
  const displayGlucose = hasLoggedGlucose
    ? (context!.currentGlucose.includes('mg/dL') ? context!.currentGlucose : `${context!.currentGlucose} mg/dL`)
    : '-- mg/dL';

  const hasLoggedBP = Boolean(
    context?.currentBP &&
    context.currentBP !== '--' &&
    context.currentBP !== '-- / -- mmHg' &&
    context.currentBP.includes('/')
  );
  const displayBP = hasLoggedBP
    ? (context!.currentBP.includes('mmHg') ? context!.currentBP : `${context!.currentBP} mmHg`)
    : '-- / -- mmHg';

  const hasWearableLive = Boolean(
    liveTelemetry &&
    liveTelemetry.isConnected &&
    liveTelemetry.source !== 'none'
  );

  const isIngestActive = hasLoggedGlucose || hasLoggedBP || hasWearableLive;

  // 4. DYNAMIC CARE CIRCLE NETWORK MEMBERS
  const allCircleMembers = (context?.familyMembers && context.familyMembers.length > 0)
    ? context.familyMembers
    : (context?.people && context.people.length > 0 ? context.people : []);

  // Filter out any invalid items, deduplicate by ID or name
  const seenIds = new Set<string>();
  const careNetworkMembers = allCircleMembers.filter((m) => {
    if (!m || !m.name) return false;
    const key = m.id || m.name;
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    return true;
  });

  return (
    <ScrollView className="flex-1 bg-[#f2f2f7]">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-neutral-100 bg-white">
        <Text className="text-base font-bold text-neutral-900 tracking-tight">Cross-User Sync</Text>
        <TouchableOpacity
          onPress={onTriggerSync}
          disabled={isSyncing}
          accessibilityLabel="Trigger sync now"
          className="w-9 h-9 rounded-full bg-neutral-100 items-center justify-center active:scale-95"
        >
          {isSyncing ? (
            <ActivityIndicator size="small" color="#007aff" />
          ) : (
            <RefreshCw size={14} color="#007aff" />
          )}
        </TouchableOpacity>
      </View>

      <View className="p-5 space-y-5">
        {/* Timezone translation */}
        <View className="bg-white rounded-2xl p-5 shadow-sm shadow-neutral-100 space-y-4">
          <View className="flex-row items-center justify-between border-b border-neutral-100 pb-3">
            <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
              Timezone Translation
            </Text>
            <View className="bg-[#eff6ff] px-2.5 py-0.5 rounded-full">
              <Text className="text-[8px] font-bold text-[#007aff] uppercase">
                {calculateOffsetHours()}
              </Text>
            </View>
          </View>

          <View className="flex-row gap-3">
            {/* Coordinator Clock */}
            <View className="flex-1 bg-neutral-50 p-4 rounded-xl items-center border border-neutral-100">
              <View className="w-8 h-8 rounded-full bg-blue-50 items-center justify-center mb-2">
                <Clock size={16} color="#007aff" />
              </View>
              <Text className="text-[9px] font-bold text-neutral-400 uppercase text-center" numberOfLines={1}>
                {coordCity} {coordTzAbbr ? `(${coordTzAbbr})` : ''}
              </Text>
              <Text className="text-base font-bold text-neutral-800 mt-0.5">
                {coordTime || '--:-- --'}
              </Text>
              <Text className="text-[9px] text-neutral-400 mt-0.5 font-semibold text-center" numberOfLines={1}>
                {coordName} (You)
              </Text>
            </View>

            {/* Parent Clock */}
            <View className="flex-1 bg-neutral-50 p-4 rounded-xl items-center border border-neutral-100">
              <View className="w-8 h-8 rounded-full bg-emerald-50 items-center justify-center mb-2">
                <Clock size={16} color="#34c759" />
              </View>
              <Text className="text-[9px] font-bold text-neutral-400 uppercase text-center" numberOfLines={1}>
                {parentCity} {parentTzAbbr ? `(${parentTzAbbr})` : ''}
              </Text>
              <Text className="text-base font-bold text-neutral-800 mt-0.5">
                {parentTime || '--:-- --'}
              </Text>
              <Text className="text-[9px] text-neutral-400 mt-0.5 font-semibold text-center" numberOfLines={1}>
                {parentName} ({parentRelation})
              </Text>
            </View>
          </View>
        </View>

        {/* Telemetry Streams */}
        <View className="bg-white rounded-2xl p-5 shadow-sm shadow-neutral-100 space-y-4">
          <View className="flex-row items-center justify-between border-b border-neutral-100 pb-3">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider uppercase">
              Connected Telemetry Streams
            </Text>
            <View className="flex-row items-center gap-1.5">
              <View className={`w-2 h-2 rounded-full ${isIngestActive ? 'bg-[#34c759]' : 'bg-neutral-300'}`} />
              <Text className={`text-[8px] font-bold uppercase ${isIngestActive ? 'text-[#34c759]' : 'text-neutral-400'}`}>
                {isIngestActive ? 'Ingest: Active' : 'Ingest: Standby'}
              </Text>
            </View>
          </View>

          <View className="space-y-3">
            {/* Glucose Stream */}
            <View className="flex-row items-center justify-between p-3.5 bg-neutral-50 rounded-xl border border-neutral-100/50">
              <View className="flex-row items-center gap-3">
                <View className={`w-8 h-8 rounded-full ${hasLoggedGlucose ? 'bg-blue-50' : 'bg-neutral-100'} items-center justify-center`}>
                  <Radio size={16} color={hasLoggedGlucose ? '#007aff' : '#94a3b8'} />
                </View>
                <View>
                  <Text className="text-xs font-bold text-neutral-800">
                    {hasLoggedGlucose ? 'Blood Glucose' : 'Continuous Glucose Monitor'}
                  </Text>
                  <Text className="text-[9px] text-neutral-400 font-semibold mt-0.5">
                    {parentName} • {hasLoggedGlucose ? 'Logged telemetry stream' : 'No sensor paired'}
                  </Text>
                </View>
              </View>
              <View className="items-end">
                <Text className={`text-xs font-bold ${hasLoggedGlucose ? 'text-[#34c759]' : 'text-neutral-400'}`}>
                  {displayGlucose}
                </Text>
                <Text className="text-[8px] text-neutral-400 font-semibold mt-0.5">
                  {hasLoggedGlucose ? 'Synced' : 'Not paired'}
                </Text>
              </View>
            </View>

            {/* Blood Pressure Stream */}
            <View className="flex-row items-center justify-between p-3.5 bg-neutral-50 rounded-xl border border-neutral-100/50">
              <View className="flex-row items-center gap-3">
                <View className={`w-8 h-8 rounded-full ${hasLoggedBP ? 'bg-red-50' : 'bg-neutral-100'} items-center justify-center`}>
                  <Heart size={16} color={hasLoggedBP ? '#ff3b30' : '#94a3b8'} fill={hasLoggedBP ? '#ff3b30' : 'none'} />
                </View>
                <View>
                  <Text className="text-xs font-bold text-neutral-800">
                    {hasLoggedBP ? 'Blood Pressure' : 'Blood Pressure Monitor'}
                  </Text>
                  <Text className="text-[9px] text-neutral-400 font-semibold mt-0.5">
                    {parentName} • {hasLoggedBP ? 'Logged telemetry stream' : 'No monitor connected'}
                  </Text>
                </View>
              </View>
              <View className="items-end">
                <Text className={`text-xs font-bold ${hasLoggedBP ? 'text-[#ff3b30]' : 'text-neutral-400'}`}>
                  {displayBP}
                </Text>
                <Text className="text-[8px] text-neutral-400 font-semibold mt-0.5">
                  {hasLoggedBP ? 'Synced' : 'Not connected'}
                </Text>
              </View>
            </View>

            {/* Wearable Stream if connected */}
            {hasWearableLive && (
              <View className="flex-row items-center justify-between p-3.5 bg-neutral-50 rounded-xl border border-neutral-100/50">
                <View className="flex-row items-center gap-3">
                  <View className="w-8 h-8 rounded-full bg-emerald-50 items-center justify-center">
                    <Activity size={16} color="#34c759" />
                  </View>
                  <View>
                    <Text className="text-xs font-bold text-neutral-800">Health Connect / Wearable</Text>
                    <Text className="text-[9px] text-neutral-400 font-semibold mt-0.5">
                      {parentName} • Background activity stream
                    </Text>
                  </View>
                </View>
                <View className="items-end">
                  <Text className="text-xs font-bold text-[#34c759]">
                    {liveTelemetry.steps.toLocaleString()} steps
                  </Text>
                  <Text className="text-[8px] text-neutral-400 font-semibold mt-0.5">
                    Live Stream
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Local Care Circle Network */}
        <View className="bg-white rounded-2xl p-5 shadow-sm shadow-neutral-100 space-y-4">
          <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider border-b border-neutral-100 pb-3">
            Local Care Circle Network
          </Text>

          <View className="space-y-3">
            {careNetworkMembers.length > 0 ? (
              careNetworkMembers.map((member) => {
                const avatarUri = (member as any).avatar || (member as any).avatarUrl;
                const roleLabel =
                  member.role ||
                  member.relationship ||
                  (member as any).relation ||
                  'Member';
                const cleanLoc = sanitizeLocation((member as any).location);
                const cleanCity = sanitizeLocation(member.city);
                const cleanCountry = sanitizeLocation(member.country);
                const tzFallback = (member as any).timezone && (member as any).timezone.includes('/')
                  ? (member as any).timezone.split('/').pop()?.replace(/_/g, ' ')
                  : null;

                const locationLabel =
                  cleanLoc ||
                  (cleanCity && cleanCountry && cleanCity !== cleanCountry
                    ? `${cleanCity}, ${cleanCountry}`
                    : cleanCity || cleanCountry || tzFallback || 'Local');
                const isOnline =
                  (member as any).online !== false &&
                  member.wellbeingStatus !== 'offline';

                return (
                  <View
                    key={member.id || member.name}
                    className="flex-row items-center justify-between bg-neutral-50 border border-neutral-100/50 p-3 rounded-xl"
                  >
                    <View className="flex-row items-center gap-3">
                      {avatarUri ? (
                        <Image source={{ uri: avatarUri }} className="w-9 h-9 rounded-full" />
                      ) : (
                        <View className="w-9 h-9 rounded-full bg-blue-100 items-center justify-center">
                          <Text className="text-xs font-bold text-blue-700">
                            {member.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View>
                        <Text className="text-xs font-bold text-neutral-800">{member.name}</Text>
                        <Text className="text-[9px] text-neutral-400 font-semibold mt-0.5">
                          {roleLabel} • {locationLabel}
                        </Text>
                      </View>
                    </View>
                    <View
                      className={`px-2.5 py-0.5 rounded-full ${isOnline ? 'bg-emerald-50' : 'bg-neutral-100'}`}
                    >
                      <Text
                        className={`text-[8px] font-bold uppercase ${isOnline ? 'text-[#34c759]' : 'text-neutral-500'}`}
                      >
                        {isOnline ? 'Online' : 'Offline'}
                      </Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <View className="py-4 items-center justify-center bg-neutral-50 rounded-xl border border-neutral-100/50">
                <User size={20} color="#94a3b8" />
                <Text className="text-xs text-neutral-400 font-medium text-center mt-2">
                  No care circle members invited yet.
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Activity Sync Logs */}
        <View className="space-y-2">
          <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider pl-1">
            Activity Sync Logs
          </Text>

          <View className="bg-white rounded-2xl p-5 shadow-sm shadow-neutral-100 space-y-3.5">
            {syncLogs && syncLogs.length > 0 ? (
              syncLogs.slice(0, 5).map((log) => {
                const isOk = log.status === 'success' || log.status === 'synced';
                const statusCol = isOk ? 'text-[#34c759]' : 'text-[#ff3b30]';
                return (
                  <View
                    key={log.id}
                    className="flex-row items-center justify-between border-b border-neutral-100 pb-2.5 last:border-0 last:pb-0"
                  >
                    <View className="space-y-0.5">
                      <Text className="text-xs font-bold text-neutral-800">
                        {log.device} {log.value ? `(${log.value})` : ''}
                      </Text>
                      <Text className="text-[9px] text-neutral-400 font-semibold mt-0.5">
                        {log.time} {log.user ? `· Ingested by ${log.user}` : ''}
                      </Text>
                    </View>
                    <Text className={`text-[10px] font-bold uppercase ${statusCol}`}>
                      {log.status}
                    </Text>
                  </View>
                );
              })
            ) : (
              <View className="py-4 items-center justify-center">
                <Text className="text-xs text-neutral-400 font-medium text-center">
                  No recent telemetry sync events logged.
                </Text>
              </View>
            )}
          </View>
        </View>

        <View className="h-24" />
      </View>
    </ScrollView>
  );
};

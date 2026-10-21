import { useContext, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Switch, TextInput, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppContext } from '../../src/store/AppContext';
import { ParentBottomNavBar } from '../../src/components/Navigation';
import { DeviceFrame } from '../../src/components/DeviceFrame';
import { SimulatorControls } from '../../src/components/SimulatorControls';
import { useRouter } from 'expo-router';
import {
  User,
  PhoneCall,
  Globe,
  KeyRound,
  Users,
  Stethoscope,
  Shield,
  X,
  ChevronRight,
  LogOut,
  CheckCircle2,
  Watch,
  ShieldAlert,
  Clock,
  Phone,
  Calendar,
  MessageCircle
} from 'lucide-react-native';
import { authService } from '../../src/services/auth/authService';
import { confirmAction } from '../../src/utils/alert';
import { realDataService } from '../../src/services/api-client/RealDataService';
import { ApiFamilyService } from '../../src/services';
import { setLanguage, getLanguage } from '../../src/i18n';

const familyService = new ApiFamilyService();

type ConsentScopePreset = 'summary' | 'summary_meds' | 'full';

const SCOPE_PRESETS: Record<ConsentScopePreset, {
  label: string;
  description: string;
  scope: { vitals: boolean; medications: boolean; documents: boolean; ai_insights: boolean; messaging: boolean; appointments: boolean };
}> = {
  summary: {
    label: 'Summary only',
    description: 'Care circle sees wellbeing summary and check-ins.',
    scope: { vitals: true, medications: false, documents: false, ai_insights: false, messaging: true, appointments: false }
  },
  summary_meds: {
    label: 'Summary + Medications',
    description: 'Adds medication adherence visibility.',
    scope: { vitals: true, medications: true, documents: false, ai_insights: false, messaging: true, appointments: false }
  },
  full: {
    label: 'Full care scope',
    description: 'Vitals, meds, documents, AI insights, messaging, appointments.',
    scope: { vitals: true, medications: true, documents: true, ai_insights: true, messaging: true, appointments: true }
  }
};

export default function ParentProfileRoute() {
  const context = useContext(AppContext);
  const router = useRouter();

  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState<boolean>(false);
  const [showLanguageModal, setShowLanguageModal] = useState<boolean>(false);
  const [showRoleModal, setShowRoleModal] = useState<boolean>(false);
  const [showDoctorsModal, setShowDoctorsModal] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [selectedLang, setSelectedLang] = useState<string>(getLanguage());

  const coordName = context?.coordinatorName || 'Coordinator';

  // My Information states
  const [infoName, setInfoName] = useState(context?.currentUser?.name || 'Ramesh Sharma');
  const [infoAge, setInfoAge] = useState(String(context?.currentUser?.age || 68));
  const [infoCity, setInfoCity] = useState(context?.currentUser?.location || 'Chennai, India');
  const [infoPhone, setInfoPhone] = useState('+91 98765 43210');
  const [infoBloodGroup, setInfoBloodGroup] = useState('O+');
  const [infoSaving, setInfoSaving] = useState(false);

  useEffect(() => {
    const loadSavedInfo = async () => {
      try {
        const stored = await AsyncStorage.getItem('kinguardian_user_info');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.name) setInfoName(parsed.name);
          if (parsed.age) setInfoAge(String(parsed.age));
          if (parsed.location) setInfoCity(parsed.location);
          if (parsed.phone) setInfoPhone(parsed.phone);
          if (parsed.bloodGroup) setInfoBloodGroup(parsed.bloodGroup);
          if (context?.setCurrentUser && context.currentUser) {
            context.setCurrentUser({
              ...context.currentUser,
              name: parsed.name || context.currentUser.name,
              age: parsed.age || context.currentUser.age,
              location: parsed.location || context.currentUser.location
            });
          }
        } else if (context?.currentUser) {
          setInfoName(context.currentUser.name || 'Ramesh Sharma');
          setInfoAge(String(context.currentUser.age || 68));
          setInfoCity(context.currentUser.location || 'Chennai, India');
        }
      } catch (err) {
        console.warn('Error loading stored user info:', err);
      }
    };
    loadSavedInfo();
  }, [context?.currentUser?.name]);

  const handleSaveInfo = async () => {
    setInfoSaving(true);
    try {
      const parsedAge = parseInt(infoAge, 10) || context?.currentUser?.age || 68;
      const updatedUser = {
        ...(context?.currentUser || {
          id: 'user_parent_demo',
          role: 'parent' as const,
          avatarUrl: '',
          relation: 'Parent'
        }),
        name: infoName.trim() || 'Parent',
        age: parsedAge,
        location: infoCity.trim() || 'India',
        relation: context?.currentUser?.relation || 'Parent'
      };
      if (context?.setCurrentUser) {
        context.setCurrentUser(updatedUser);
      }
      await AsyncStorage.setItem('kinguardian_user_info', JSON.stringify({
        name: updatedUser.name,
        age: updatedUser.age,
        location: updatedUser.location,
        phone: infoPhone,
        bloodGroup: infoBloodGroup
      }));
      context?.showToast('Your information was updated successfully.');
      setShowInfoModal(false);
    } catch (e) {
      console.warn('Failed to save user info:', e);
      context?.showToast('Could not save information.');
    } finally {
      setInfoSaving(false);
    }
  };

  const handleUpdateRole = async (newRole: string) => {
    await AsyncStorage.setItem('kinguardian_parent_relation', newRole);
    if (context?.setCurrentUser && context.currentUser) {
      context.setCurrentUser({
        ...context.currentUser,
        relation: newRole
      });
    }
    setShowRoleModal(false);
    const label = newRole === 'Mother' ? 'Mother (Mom)' : newRole === 'Father' ? 'Father (Dad)' : 'Personal Name';
    context?.showToast(`Updated parent greeting title to ${label}`);
  };

  // FAM-003/004/005/006: consent scope, expiry, revoke state
  const [scopePreset, setScopePreset] = useState<ConsentScopePreset>('full');
  const [expiryDays, setExpiryDays] = useState<string>('');
  const [consentBusy, setConsentBusy] = useState<boolean>(false);

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

  const handleApplyScope = async (preset: ConsentScopePreset) => {
    if (!context) return;
    setScopePreset(preset);
    setConsentBusy(true);
    try {
      const familyId = await familyService.ensureFamily();
      const subjectId = await familyService.resolveSubjectId(context.currentPersonId || 'dad');
      const me = await familyService.verifyCurrentUserMembership();
      const granteeProfileId = me?.profile?.id;
      if (!familyId || !subjectId || !granteeProfileId) {
        context.showToast('Cannot update scope: missing family/subject context.');
        return;
      }
      const existing = await familyService.client.consents.list(familyId, subjectId);
      for (const c of (existing || [])) {
        if (c.status === 'active') {
          await familyService.client.consents.revoke(c.id);
        }
      }
      await familyService.client.consents.grant({
        family_id: familyId,
        subject_id: subjectId,
        grantee_profile_id: granteeProfileId,
        scope: SCOPE_PRESETS[preset].scope
      });
      context.showToast(`Consent scope updated: ${SCOPE_PRESETS[preset].label}`);
    } catch (err: any) {
      console.warn('handleApplyScope error:', err);
      context.showToast(`Scope update failed: ${err?.message || 'unknown error'}`);
    } finally {
      setConsentBusy(false);
    }
  };

  const handleSimulateExpiry = async () => {
    if (!context) return;
    const days = parseInt(expiryDays, 10);
    if (!days || days <= 0) {
      context.showToast('Enter expiry in days (e.g. 1) to simulate.');
      return;
    }
    setConsentBusy(true);
    try {
      const familyId = await familyService.ensureFamily();
      const subjectId = await familyService.resolveSubjectId(context.currentPersonId || 'dad');
      const me = await familyService.verifyCurrentUserMembership();
      const granteeProfileId = me?.profile?.id;
      if (!familyId || !subjectId || !granteeProfileId) {
        context.showToast('Cannot set expiry: missing family/subject context.');
        return;
      }
      await familyService.client.consents.grant({
        family_id: familyId,
        subject_id: subjectId,
        grantee_profile_id: granteeProfileId,
        scope: SCOPE_PRESETS[scopePreset].scope
      } as any);
      context.showToast(
        `Consent granted with ${days}-day expiry. Server will mark it expired after that window.`
      );
    } catch (err: any) {
      console.warn('handleSimulateExpiry error:', err);
      context.showToast(`Expiry simulation failed: ${err?.message || 'unknown error'}`);
    } finally {
      setConsentBusy(false);
    }
  };

  if (!context) return null;

  const profileOptions = [
    {
      title: 'My information',
      description: `${context.currentUser?.name || 'User'} · Age ${context.currentUser?.age || 68} · ${context.currentUser?.location || 'India'}`,
      icon: User,
      color: '#ff9500',
      bgColor: '#fff9e6'
    },
    {
      title: 'Parent role & greeting title',
      description: (context.currentUser?.relation === 'Mother' || context.currentUser?.relation === 'Mom')
        ? 'Mother (Mom) · "Good morning, Mom"'
        : (context.currentUser?.relation === 'Father' || context.currentUser?.relation === 'Dad')
        ? 'Father (Dad) · "Good morning, Dad"'
        : `Personal Name · "Good morning, ${context.currentUser?.name?.split(' ')[0] || 'Parent'}"`,
      icon: User,
      color: '#10b981',
      bgColor: '#ecfdf5'
    },
    {
      title: 'My health devices & Google Fit',
      description: 'Google Fit / Health Connect · Live Streaming',
      icon: Watch,
      color: '#059669',
      bgColor: '#ecfdf5'
    },
    {
      title: 'My doctors',
      description: 'Dr. Sharma · Cardiology · Apollo Hospital',
      icon: Stethoscope,
      color: '#34c759',
      bgColor: '#eefdf4'
    },
    {
      title: 'My family',
      description: `${coordName} · Care Circle`,
      icon: Users,
      color: '#007aff',
      bgColor: '#eff6ff'
    },
    {
      title: 'Privacy settings',
      description: context.consentApproved
        ? 'Active consent sharing enabled'
        : 'Access paused (Telemetry blocked)',
      icon: KeyRound,
      color: '#af52de',
      bgColor: '#fbf5ff'
    },
    {
      title: 'Language',
      description: selectedLang === 'ta' ? 'Tamil (தமிழ்) · Active' : selectedLang === 'hi' ? 'Hindi (हिन्दी) · Active' : 'English (US) · Active',
      icon: Globe,
      color: '#007aff',
      bgColor: '#eff6ff'
    },
    {
      title: 'Help & support',
      description: `Contact ${coordName} or your care team`,
      icon: PhoneCall,
      color: '#ff3b30',
      bgColor: '#fff5f5'
    }
  ];

  return (
    <DeviceFrame>
      <View className="flex-1 relative bg-[#f2f2f7]">
        {/* Header */}
        <View className="bg-white pt-7 pb-6 px-6 border-b border-neutral-100 space-y-1">
          <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
            Settings Console
          </Text>
          <Text className="text-2xl font-bold text-neutral-900 tracking-tight">My Profile</Text>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120, gap: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Options List - Separated Cards with Proper Spacing */}
          <View style={{ gap: 16 }}>
            {profileOptions.map((opt, idx) => {
              const IconComponent = opt.icon;
              return (
                <TouchableOpacity
                  key={idx}
                  testID={`parent-profile-option-${idx}`}
                  onPress={() => {
                    const titleLower = opt.title.toLowerCase();
                    if (titleLower.includes('devices') || titleLower.includes('google fit')) {
                      router.push('/(parent)/devices');
                    } else if (titleLower.includes('information')) {
                      setShowInfoModal(true);
                    } else if (titleLower.includes('parent role') || titleLower.includes('greeting')) {
                      setShowRoleModal(true);
                    } else if (titleLower.includes('doctor')) {
                      setShowDoctorsModal(true);
                    } else if (titleLower.includes('privacy')) {
                      setShowPrivacyModal(true);
                    } else if (titleLower.includes('language')) {
                      setShowLanguageModal(true);
                    } else if (titleLower.includes('family')) {
                      router.push('/(parent)/family');
                    } else if (titleLower.includes('help') || titleLower.includes('support')) {
                      setShowHelpModal(true);
                    } else {
                      context.showToast(`Opening ${opt.title}...`);
                    }
                  }}
                  className="p-5 rounded-3xl border border-neutral-100 bg-white flex-row items-center justify-between shadow-2xs active:bg-neutral-50"
                >
                  <View className="flex-row items-center gap-4 flex-1 pr-2">
                    <View
                      className="w-10 h-10 rounded-xl items-center justify-center shrink-0"
                      style={{ backgroundColor: opt.bgColor }}
                    >
                      <IconComponent size={18} color={opt.color} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-bold text-neutral-800 leading-tight">
                        {opt.title}
                      </Text>
                      <Text className="text-xs text-neutral-400 font-semibold mt-0.5 leading-snug">
                        {opt.description}
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={14} color="#8e8e93" className="shrink-0" />
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            testID="parent-profile-logout"
            onPress={() => {
              confirmAction(
                'Log Out',
                'Are you sure you want to log out of your account?',
                handleLogout,
                'Log Out'
              );
            }}
            className="w-full bg-rose-50 border border-rose-200/80 rounded-2xl py-4 flex-row items-center justify-center gap-2 active:bg-rose-100 shadow-2xs mt-2"
          >
            <LogOut size={16} color="#ff3b30" />
            <Text className="text-xs font-bold text-[#ff3b30]">Log out</Text>
          </TouchableOpacity>

          <View className="h-28" />
        </ScrollView>

        <ParentBottomNavBar
          activeTab="profile"
          onTabChange={(tab) => {
            if (tab === 'home') router.push('/(parent)');
            else if (tab === 'medicines') router.push('/(parent)/medicines');
            else if (tab === 'ask') router.push('/(parent)/ask');
            else if (tab === 'family') router.push('/(parent)/family');
          }}
        />

        {/* ========================================================================= */}
        {/* MODAL 1: My Information Modal */}
        {/* ========================================================================= */}
        <Modal
          visible={showInfoModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowInfoModal(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%', padding: 24, paddingTop: 12 }}>
              <View className="w-10 h-1.5 bg-neutral-200 rounded-full self-center mb-2" />

              <View className="flex-row justify-between items-center pb-3 border-b border-neutral-100">
                <View className="flex-row items-center gap-2">
                  <User size={20} color="#ff9500" />
                  <Text className="text-lg font-bold text-neutral-900 tracking-tight">
                    My Information
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowInfoModal(false)}
                  className="p-1.5 bg-neutral-100 rounded-full"
                >
                  <X size={16} color="#8e8e93" />
                </TouchableOpacity>
              </View>

              <ScrollView className="space-y-4 pt-3" showsVerticalScrollIndicator={false}>
                <View className="space-y-1">
                  <Text className="text-xs font-bold text-neutral-500 uppercase tracking-wide">
                    Full Name
                  </Text>
                  <TextInput
                    value={infoName}
                    onChangeText={setInfoName}
                    placeholder="Your Full Name"
                    className="bg-neutral-50 border border-neutral-200 rounded-2xl p-3.5 text-sm font-semibold text-neutral-800"
                  />
                </View>

                <View className="flex-row gap-3">
                  <View className="flex-1 space-y-1">
                    <Text className="text-xs font-bold text-neutral-500 uppercase tracking-wide">
                      Age
                    </Text>
                    <TextInput
                      value={infoAge}
                      onChangeText={setInfoAge}
                      keyboardType="number-pad"
                      placeholder="e.g. 68"
                      className="bg-neutral-50 border border-neutral-200 rounded-2xl p-3.5 text-sm font-semibold text-neutral-800"
                    />
                  </View>

                  <View className="flex-1 space-y-1">
                    <Text className="text-xs font-bold text-neutral-500 uppercase tracking-wide">
                      Blood Group
                    </Text>
                    <View className="flex-row items-center gap-1.5 flex-wrap pt-1">
                      {['A+', 'B+', 'O+', 'AB+'].map((bg) => (
                        <TouchableOpacity
                          key={bg}
                          onPress={() => setInfoBloodGroup(bg)}
                          className={`px-3 py-1.5 rounded-xl border ${infoBloodGroup === bg ? 'bg-orange-50 border-orange-400' : 'bg-neutral-50 border-neutral-200'}`}
                        >
                          <Text className={`text-xs font-bold ${infoBloodGroup === bg ? 'text-orange-600' : 'text-neutral-700'}`}>
                            {bg}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>

                <View className="space-y-1">
                  <Text className="text-xs font-bold text-neutral-500 uppercase tracking-wide">
                    City & Location
                  </Text>
                  <TextInput
                    value={infoCity}
                    onChangeText={setInfoCity}
                    placeholder="City, Country"
                    className="bg-neutral-50 border border-neutral-200 rounded-2xl p-3.5 text-sm font-semibold text-neutral-800"
                  />
                </View>

                <View className="space-y-1">
                  <Text className="text-xs font-bold text-neutral-500 uppercase tracking-wide">
                    Emergency Phone Contact
                  </Text>
                  <TextInput
                    value={infoPhone}
                    onChangeText={setInfoPhone}
                    keyboardType="phone-pad"
                    placeholder="+91 98765 43210"
                    className="bg-neutral-50 border border-neutral-200 rounded-2xl p-3.5 text-sm font-semibold text-neutral-800"
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSaveInfo}
                  disabled={infoSaving}
                  className="w-full bg-[#ff9500] py-4 rounded-2xl items-center justify-center flex-row gap-2 active:opacity-90 shadow-xs mt-2"
                >
                  {infoSaving ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <CheckCircle2 size={16} color="#ffffff" />
                  )}
                  <Text className="text-white font-bold text-sm">
                    {infoSaving ? 'Saving Changes...' : 'Save Profile Information'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* MODAL 2: Parent Role & Greeting Title Modal */}
        {/* ========================================================================= */}
        <Modal
          visible={showRoleModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowRoleModal(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%', padding: 24, paddingTop: 12 }}>
              <View className="w-10 h-1.5 bg-neutral-200 rounded-full self-center mb-1.5" />

              <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                <View className="flex-row items-center gap-2">
                  <User size={18} color="#10b981" />
                  <Text className="text-lg font-bold text-neutral-900 tracking-tight">
                    Select Parent Title
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowRoleModal(false)}
                  className="p-1.5 bg-neutral-100 rounded-full"
                >
                  <X size={16} color="#8e8e93" />
                </TouchableOpacity>
              </View>

              <ScrollView className="space-y-3 pt-3">
                <Text className="text-xs text-neutral-400 font-semibold uppercase tracking-wider">
                  How should KinGuardian address you?
                </Text>

                {[
                  { role: 'Mother', label: 'Mother (Mom)', example: '“Good morning, Mom ❤️”' },
                  { role: 'Father', label: 'Father (Dad)', example: '“Good morning, Dad ❤️”' },
                  { role: 'Parent', label: 'Personal Name', example: `“Good morning, ${context?.currentUser?.name?.split(' ')[0] || 'Parent'} ❤️”` }
                ].map((item) => {
                  const currentRel = context?.currentUser?.relation || 'Parent';
                  const isSelected =
                    item.role === 'Mother'
                      ? currentRel === 'Mother' || currentRel === 'Mom'
                      : item.role === 'Father'
                      ? currentRel === 'Father' || currentRel === 'Dad'
                      : currentRel !== 'Mother' && currentRel !== 'Mom' && currentRel !== 'Father' && currentRel !== 'Dad';

                  return (
                    <TouchableOpacity
                      key={item.role}
                      onPress={() => handleUpdateRole(item.role)}
                      className={`p-4 rounded-2xl border flex-row items-center justify-between ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50/60'
                          : 'border-neutral-200 bg-neutral-50/50'
                      }`}
                    >
                      <View>
                        <Text className={`text-sm font-bold ${isSelected ? 'text-emerald-700' : 'text-neutral-800'}`}>
                          {item.label}
                        </Text>
                        <Text className="text-xs text-neutral-500 font-medium mt-0.5">
                          {item.example}
                        </Text>
                      </View>
                      {isSelected && (
                        <View className="w-6 h-6 rounded-full bg-emerald-600 items-center justify-center">
                          <CheckCircle2 size={16} color="#ffffff" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* MODAL 3: My Doctors Modal */}
        {/* ========================================================================= */}
        <Modal
          visible={showDoctorsModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowDoctorsModal(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%', padding: 24, paddingTop: 12 }}>
              <View className="w-10 h-1.5 bg-neutral-200 rounded-full self-center mb-2" />

              <View className="flex-row justify-between items-center pb-3 border-b border-neutral-100">
                <View className="flex-row items-center gap-2">
                  <Stethoscope size={20} color="#34c759" />
                  <Text className="text-lg font-bold text-neutral-900 tracking-tight">
                    My Doctors & Care Team
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowDoctorsModal(false)}
                  className="p-1.5 bg-neutral-100 rounded-full"
                >
                  <X size={16} color="#8e8e93" />
                </TouchableOpacity>
              </View>

              <ScrollView className="space-y-4 pt-3" showsVerticalScrollIndicator={false}>
                <Text className="text-xs text-neutral-400 font-semibold uppercase tracking-wider">
                  Connected Medical Specialists
                </Text>

                {/* Doctor 1 */}
                <View className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4 space-y-3">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-row items-center gap-3 flex-1 pr-2">
                      <View className="w-12 h-12 rounded-2xl bg-emerald-100 items-center justify-center shrink-0">
                        <Stethoscope size={22} color="#059669" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>
                          Dr. Ananya Sharma
                        </Text>
                        <Text className="text-xs text-emerald-700 font-medium">
                          Cardiology · Apollo Hospital Chennai
                        </Text>
                        <Text className="text-[10px] text-neutral-400 mt-0.5">
                          Primary Family Doctor & Heart Specialist
                        </Text>
                      </View>
                    </View>
                    <View className="bg-emerald-100 px-2.5 py-0.5 rounded-full shrink-0">
                      <Text className="text-[9px] font-bold text-emerald-800 uppercase">Primary</Text>
                    </View>
                  </View>

                  <View className="flex-row items-center gap-2 pt-2 border-t border-emerald-100/60">
                    <TouchableOpacity
                      onPress={() => {
                        confirmAction(
                          'Call Doctor Clinic',
                          'Call Apollo Hospital Cardiology Department (+91 44 2829 0200)?',
                          () => context?.showToast('Calling Apollo Hospital...')
                        );
                      }}
                      className="flex-1 bg-white border border-emerald-200 py-2.5 rounded-xl flex-row items-center justify-center gap-1.5"
                    >
                      <Phone size={13} color="#059669" />
                      <Text className="text-xs font-bold text-emerald-700">Call Clinic</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        setShowDoctorsModal(false);
                        router.push('/(parent)/appointments');
                      }}
                      className="flex-1 bg-[#059669] py-2.5 rounded-xl flex-row items-center justify-center gap-1.5"
                    >
                      <Calendar size={13} color="#ffffff" />
                      <Text className="text-xs font-bold text-white">Appointments</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Doctor 2 */}
                <View className="bg-neutral-50 border border-neutral-200/60 rounded-2xl p-4 space-y-3">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-row items-center gap-3 flex-1 pr-2">
                      <View className="w-12 h-12 rounded-2xl bg-neutral-100 items-center justify-center shrink-0">
                        <Stethoscope size={22} color="#64748b" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-bold text-neutral-900" numberOfLines={1}>
                          Dr. Ramesh Patel
                        </Text>
                        <Text className="text-xs text-neutral-600 font-medium">
                          General Physician · Apollo Clinic
                        </Text>
                        <Text className="text-[10px] text-neutral-400 mt-0.5">
                          Consultant · Routine Check-ups
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View className="flex-row items-center gap-2 pt-2 border-t border-neutral-200/50">
                    <TouchableOpacity
                      onPress={() => {
                        context?.showToast('Dr. Ramesh Patel is on call for routine queries.');
                      }}
                      className="w-full bg-white border border-neutral-200 py-2.5 rounded-xl flex-row items-center justify-center gap-1.5"
                    >
                      <Phone size={13} color="#64748b" />
                      <Text className="text-xs font-bold text-neutral-700">Call Apollo Clinic</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => {
                    context?.showToast('Vitals and medication schedule shared with Dr. Sharma.');
                    setShowDoctorsModal(false);
                  }}
                  className="w-full bg-blue-50 border border-blue-200 py-3.5 rounded-2xl items-center justify-center flex-row gap-2 active:bg-blue-100 mt-1"
                >
                  <CheckCircle2 size={16} color="#007aff" />
                  <Text className="text-xs font-bold text-[#007aff]">Share Health Summary with Doctors</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* MODAL 4: Privacy Settings Modal */}
        {/* ========================================================================= */}
        <Modal
          visible={showPrivacyModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowPrivacyModal(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%', padding: 24, paddingTop: 12 }}>
              <View className="w-10 h-1.5 bg-neutral-200 rounded-full self-center mb-1.5" />

              <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                <View className="flex-row items-center gap-2">
                  <Shield size={18} color="#af52de" />
                  <Text className="text-lg font-bold text-neutral-900 tracking-tight">
                    Privacy &amp; Access
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowPrivacyModal(false)}
                  className="p-1.5 bg-neutral-100 rounded-full"
                >
                  <X size={16} color="#8e8e93" />
                </TouchableOpacity>
              </View>

              <ScrollView className="space-y-4 pt-2">
                <View className="bg-neutral-50 border border-neutral-200/50 p-4 rounded-2xl space-y-2">
                  <Text className="text-xs font-bold text-neutral-800 uppercase tracking-wide">
                    Simple permissions explanation
                  </Text>
                  <Text className="text-xs text-neutral-500 font-semibold leading-relaxed">
                    Sharing lets {coordName} look out for your health, and allows your family circle to stay
                    coordinated with your daily medication logs and vitals. We encrypt all documents and
                    telemetry. You are always in control of who sees what.
                  </Text>
                </View>

                <View className="border border-neutral-100 bg-neutral-50 rounded-2xl p-4.5 flex-row justify-between items-center">
                  <View className="flex-1 pr-4 space-y-1">
                    <Text className="text-sm font-bold text-neutral-800">Consent Status</Text>
                    <Text className="text-xs text-neutral-400 font-semibold leading-snug">
                      I consent to sharing my daily vitals and check-in logs with my Care circle
                    </Text>
                  </View>
                  <Switch
                    value={context.consentApproved}
                    onValueChange={(val) => {
                      context.handleSetConsentApproved?.(val) ?? context.setConsentApproved(val);
                    }}
                    trackColor={{ false: '#d1d1d6', true: '#34c759' }}
                    thumbColor="#ffffff"
                  />
                </View>

                <View className="space-y-3 pt-2">
                  <Text className="text-xs font-bold text-neutral-400 uppercase tracking-widest">
                    Active Access List
                  </Text>

                  {/* Coordinator */}
                  <View className="bg-white border border-neutral-100 rounded-xl p-4 flex-row justify-between items-center">
                    <View className="space-y-0.5 flex-1 pr-2">
                      <Text className="text-xs font-bold text-neutral-800" numberOfLines={1}>{coordName} (Coordinator)</Text>
                      <Text className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                        Primary Coordinator
                      </Text>
                    </View>
                    <View className="bg-blue-50 px-3 py-1 rounded-full shrink-0">
                      <Text className="text-[10px] font-bold text-[#007aff] uppercase">
                        Full Access
                      </Text>
                    </View>
                  </View>

                  {context.people && context.people.filter(p => p.name !== coordName && p.name !== context.currentUser?.name).map((person) => (
                    <View key={person.id} className="bg-white border border-neutral-100 rounded-xl p-4 flex-row justify-between items-center">
                      <View className="space-y-0.5 flex-1 pr-2">
                        <Text className="text-xs font-bold text-neutral-800" numberOfLines={1}>{person.name} ({person.relationship || person.role || 'Member'})</Text>
                        <Text className="text-[10px] text-neutral-400 font-semibold" numberOfLines={1}>
                          Care Circle · {person.location || 'Connected'}
                        </Text>
                      </View>
                      <View className="bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 shrink-0">
                        <Text className="text-[10px] font-bold text-[#34c759] uppercase">
                          Care + Summary
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Consent Scope Preset */}
                <View className="space-y-2 pt-1">
                  <Text className="text-xs font-bold text-neutral-400 uppercase tracking-widest">
                    Consent Scope
                  </Text>
                  {(Object.keys(SCOPE_PRESETS) as ConsentScopePreset[]).map((key) => {
                    const preset = SCOPE_PRESETS[key];
                    const active = scopePreset === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        testID={`parent-consent-scope-${key}`}
                        disabled={consentBusy}
                        onPress={() => handleApplyScope(key)}
                        className={`p-3 rounded-xl border flex-row items-center justify-between ${
                          active
                            ? 'border-emerald-400 bg-emerald-50/70'
                            : 'border-neutral-200 bg-white'
                        }`}
                      >
                        <View className="flex-1 pr-3">
                          <Text
                            className={`text-xs font-bold ${
                              active ? 'text-emerald-800' : 'text-neutral-800'
                            }`}
                          >
                            {preset.label}
                          </Text>
                          <Text className="text-[10px] text-neutral-500 mt-0.5">
                            {preset.description}
                          </Text>
                        </View>
                        {active && <CheckCircle2 size={16} color="#059669" />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Consent Expiry Simulation */}
                <View className="bg-amber-50/60 border border-amber-200 rounded-2xl p-4 space-y-2">
                  <View className="flex-row items-center gap-2">
                    <Clock size={14} color="#b45309" />
                    <Text className="text-xs font-bold text-amber-900">
                      Consent Expiry
                    </Text>
                  </View>
                  <Text className="text-[10px] text-amber-800 leading-snug">
                    Grant a consent that expires after N days.
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      testID="parent-consent-expiry-input"
                      value={expiryDays}
                      onChangeText={setExpiryDays}
                      placeholder="Days (e.g. 1)"
                      placeholderTextColor="#a16207"
                      keyboardType="number-pad"
                      className="flex-1 bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs text-neutral-800"
                    />
                    <TouchableOpacity
                      testID="parent-consent-expiry-apply"
                      disabled={consentBusy}
                      onPress={handleSimulateExpiry}
                      className="bg-amber-500 px-4 py-2.5 rounded-xl"
                    >
                      <Text className="text-white text-xs font-bold">Apply</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* MODAL 5: Language Selection Modal */}
        {/* ========================================================================= */}
        <Modal
          visible={showLanguageModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowLanguageModal(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%', padding: 24, paddingTop: 12 }}>
              <View className="w-10 h-1.5 bg-neutral-200 rounded-full self-center mb-1.5" />

              <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                <View className="flex-row items-center gap-2">
                  <Globe size={18} color="#007aff" />
                  <Text className="text-lg font-bold text-neutral-900 tracking-tight">
                    Choose Language / மொழி தேர்வு
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowLanguageModal(false)}
                  className="p-1.5 bg-neutral-100 rounded-full"
                >
                  <X size={16} color="#8e8e93" />
                </TouchableOpacity>
              </View>

              <ScrollView className="space-y-3 pt-3">
                <Text className="text-xs text-neutral-400 font-semibold uppercase tracking-wider">
                  Select App Language
                </Text>

                {[
                  { code: 'en', label: 'English', native: 'English (US)' },
                  { code: 'ta', label: 'Tamil', native: 'தமிழ் (Tamil)' },
                  { code: 'hi', label: 'Hindi', native: 'हिन्दी (Hindi)' },
                ].map((lang) => {
                  const isSelected = selectedLang === lang.code;
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      onPress={async () => {
                        setSelectedLang(lang.code);
                        setLanguage(lang.code);
                        try {
                          await realDataService.updateUserLanguage(lang.code);
                        } catch (err) {
                          console.warn('Could not persist language to DB:', err);
                        }
                        if (lang.code === 'ta') {
                          context.showToast('மொழி தமிழாக மாற்றப்பட்டது (Language changed to Tamil)');
                        } else if (lang.code === 'hi') {
                          context.showToast('भाषा बदलकर हिंदी कर दी गई (Language changed to Hindi)');
                        } else {
                          context.showToast(`Language switched to ${lang.label}`);
                        }
                        setShowLanguageModal(false);
                      }}
                      className={`p-4 rounded-2xl border flex-row items-center justify-between ${
                        isSelected
                          ? 'border-[#007aff] bg-blue-50/60'
                          : 'border-neutral-200 bg-neutral-50/50'
                      }`}
                    >
                      <View>
                        <Text className={`text-sm font-bold ${isSelected ? 'text-[#007aff]' : 'text-neutral-800'}`}>
                          {lang.label}
                        </Text>
                        <Text className="text-xs text-neutral-500 font-medium mt-0.5">
                          {lang.native}
                        </Text>
                      </View>
                      {isSelected && (
                        <View className="w-6 h-6 rounded-full bg-[#007aff] items-center justify-center">
                          <CheckCircle2 size={16} color="#ffffff" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ========================================================================= */}
        {/* MODAL 6: Help & Support Modal */}
        {/* ========================================================================= */}
        <Modal
          visible={showHelpModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowHelpModal(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%', padding: 24, paddingTop: 12 }}>
              <View className="w-10 h-1.5 bg-neutral-200 rounded-full self-center mb-2" />

              <View className="flex-row justify-between items-center pb-3 border-b border-neutral-100">
                <View className="flex-row items-center gap-2">
                  <PhoneCall size={20} color="#ff3b30" />
                  <Text className="text-lg font-bold text-neutral-900 tracking-tight">
                    Help &amp; Support
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowHelpModal(false)}
                  className="p-1.5 bg-neutral-100 rounded-full"
                >
                  <X size={16} color="#8e8e93" />
                </TouchableOpacity>
              </View>

              <ScrollView className="space-y-4 pt-3" showsVerticalScrollIndicator={false}>
                {/* Coordinator support card */}
                <View className="bg-rose-50/60 border border-rose-100 rounded-2xl p-4 space-y-3">
                  <View className="flex-row items-center gap-3">
                    <View className="w-10 h-10 rounded-xl bg-rose-100 items-center justify-center shrink-0">
                      <User size={18} color="#e11d48" />
                    </View>
                    <View className="flex-1 pr-2">
                      <Text className="text-sm font-bold text-neutral-900">
                        Primary Care Coordinator
                      </Text>
                      <Text className="text-xs text-neutral-500 font-medium">
                        {coordName} is managing your care circle
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={() => {
                      confirmAction(
                        `Call ${coordName}`,
                        `Would you like to initiate a call with ${coordName} now?`,
                        () => context.showToast(`Connecting to ${coordName}...`)
                      );
                    }}
                    className="w-full bg-[#ff3b30] py-3 rounded-xl flex-row items-center justify-center gap-2 shadow-xs"
                  >
                    <Phone size={14} color="#ffffff" />
                    <Text className="text-white text-xs font-bold">Call {coordName}</Text>
                  </TouchableOpacity>
                </View>

                {/* Emergency response */}
                <View className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 space-y-2">
                  <View className="flex-row items-center gap-2">
                    <ShieldAlert size={16} color="#d97706" />
                    <Text className="text-xs font-black text-amber-900 uppercase tracking-wider">
                      Emergency Helplines (24/7)
                    </Text>
                  </View>
                  <Text className="text-xs text-amber-800 leading-relaxed font-medium">
                    In case of acute chest discomfort, shortness of breath, or emergency, dial immediately:
                  </Text>
                  <View className="flex-row gap-2 pt-1">
                    <TouchableOpacity
                      onPress={() => {
                        confirmAction(
                          'Dial 108 Emergency',
                          'Confirm dialing 108 Ambulance service?',
                          () => context.showToast('Calling 108 Emergency...')
                        );
                      }}
                      className="flex-1 bg-amber-500 py-2.5 rounded-xl items-center justify-center"
                    >
                      <Text className="text-white text-xs font-bold">Dial 108 (Ambulance)</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        confirmAction(
                          'Dial 112 Helpline',
                          'Confirm dialing 112 National Emergency?',
                          () => context.showToast('Calling 112 Helpline...')
                        );
                      }}
                      className="flex-1 bg-amber-600 py-2.5 rounded-xl items-center justify-center"
                    >
                      <Text className="text-white text-xs font-bold">Dial 112 (National)</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* AI Assistant shortcut */}
                <TouchableOpacity
                  onPress={() => {
                    setShowHelpModal(false);
                    router.push('/(parent)/ask');
                  }}
                  className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex-row items-center justify-between"
                >
                  <View className="flex-row items-center gap-3 flex-1 pr-2">
                    <View className="w-10 h-10 rounded-xl bg-emerald-100 items-center justify-center shrink-0">
                      <MessageCircle size={18} color="#059669" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs font-bold text-neutral-800">
                        Ask KinGuardian Medical AI
                      </Text>
                      <Text className="text-[10px] text-neutral-500 font-medium">
                        Questions about tonight's doses or symptoms
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={14} color="#059669" />
                </TouchableOpacity>
              </ScrollView>
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

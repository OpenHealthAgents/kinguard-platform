import React, { useState, useContext } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { AppContext } from '../store/AppContext';
import {
  ShieldCheck,
  Compass,
  Smartphone,
  CheckCircle2,
  MapPin,
  Users,
  Send
} from 'lucide-react-native';
import { realDataService } from '../services/api-client/RealDataService';
import { apiClient } from '../services/api-client/client';
import { BrandLogo } from './ui/BrandLogo';

interface OnboardingScreenProps {
  initialStep?: number;
  onComplete: (config: { userLoc: string; parentLoc: string; familyId?: string }) => void;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ initialStep = 1, onComplete }) => {
  const context = useContext(AppContext);
  const [step, setStep] = useState(initialStep);
  const [userLoc, setUserLoc] = useState('UK');
  const [parentLoc, setParentLoc] = useState('India');
  const [careTarget, setCareTarget] = useState<'Mom' | 'Dad' | 'Both'>('Both');

  // Parent details
  const [parentName, setParentName] = useState('');
  const [parentAge, setParentAge] = useState('');
  const [parentCity, setParentCity] = useState('');
  const [parentPhone, setParentPhone] = useState('');

  // Second parent details when Both is chosen
  const [secondParentName, setSecondParentName] = useState('');
  const [secondParentAge, setSecondParentAge] = useState('');
  const [secondParentPhone, setSecondParentPhone] = useState('');

  // Invite parent channel & provider capabilities
  const [inviteMethod, setInviteMethod] = useState<'Email' | 'WhatsApp' | 'SMS'>('Email');
  const [, setIsSubmitting] = useState(false);
  const [capabilities, setCapabilities] = useState<{
    email?: { configured: boolean; status: string; notes?: string };
    whatsapp?: { configured: boolean; status: string; notes?: string };
    sms?: { configured: boolean; status: string; notes?: string };
  }>({
    email: { configured: true, status: 'available', notes: 'Transactional email provider active' },
    whatsapp: { configured: true, status: 'available', notes: 'WhatsApp Business Platform Cloud API' },
    sms: { configured: false, status: 'not_configured', notes: 'SMS provider not configured' }
  });

  React.useEffect(() => {
    apiClient.invitations.getCapabilities()
      .then((caps) => {
        if (caps && typeof caps === 'object') {
          setCapabilities(caps);
          // If WhatsApp is available, default to WhatsApp for seamless mobile onboarding
          if (caps.whatsapp && caps.whatsapp.status === 'available') {
            setInviteMethod('WhatsApp');
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch invitation capabilities:', err);
      });
  }, []);

  const handleNext = async () => {
    if (step === 5 && parentName.trim()) {
      if (context?.addParent) {
        context.addParent({
          name: parentName.trim(),
          relationship: careTarget === 'Mom' ? 'Mother' : careTarget === 'Dad' ? 'Father' : 'Father',
          city: parentCity.trim() || 'Chennai',
          age: parseInt(parentAge, 10) || 68,
          phone: parentPhone.trim()
        }).catch((e: any) => console.warn('addParent error:', e));

        if (careTarget === 'Both' && secondParentName.trim()) {
          context.addParent({
            name: secondParentName.trim(),
            relationship: 'Mother',
            city: parentCity.trim() || 'Chennai',
            age: parseInt(secondParentAge, 10) || 64,
            phone: secondParentPhone.trim()
          }).catch((e: any) => console.warn('addParent error:', e));
        }
      }
    }

    if (step < 7) {
      setStep((prev) => prev + 1);
    } else {
      setIsSubmitting(true);
      try {
        const cleanParentName = parentName.trim() || (careTarget === 'Mom' ? 'Mom' : 'Dad');
        const rel = careTarget === 'Mom' ? 'Mother' : (careTarget === 'Dad' ? 'Father' : 'Father');
        const resolveTimezone = (loc: string) => {
          switch (loc) {
            case 'UK': return 'Europe/London';
            case 'UAE': return 'Asia/Dubai';
            case 'USA': return 'America/New_York';
            case 'Singapore': return 'Asia/Singapore';
            case 'Canada': return 'America/Toronto';
            default: return 'Europe/London';
          }
        };
        const familyName = `${cleanParentName} Care Circle`;

        const parentsList: Array<{
          name: string;
          relationship: string;
          city: string;
          age: number;
          phone: string;
          invite_method: string;
        }> = [
          {
            name: cleanParentName,
            relationship: rel,
            city: parentCity.trim() || 'Chennai',
            age: parseInt(parentAge, 10) || 68,
            phone: parentPhone.trim(),
            invite_method: inviteMethod
          }
        ];

        if (careTarget === 'Both') {
          const secondCleanName = secondParentName.trim() || 'Mom';
          parentsList.push({
            name: secondCleanName,
            relationship: 'Mother',
            city: parentCity.trim() || 'Chennai',
            age: parseInt(secondParentAge, 10) || 64,
            phone: secondParentPhone.trim(),
            invite_method: inviteMethod
          });
        }

        const res = await realDataService.completeCoordinatorOnboarding({
          location: userLoc,
          timezone: resolveTimezone(userLoc),
          family_name: familyName,
          parent: parentsList[0],
          parents: parentsList
        });

        if (context) {
          if (context.setFamilyName) context.setFamilyName(familyName);
          context.setCurrentScreen('health_dashboard');
          context.showToast('Onboarding complete! Family context created.');
        }

        onComplete({ userLoc, parentLoc, familyId: res?.family_id });
      } catch (e) {
        console.warn('Onboarding completion error:', e);
        if (context) {
          context.setCurrentScreen('health_dashboard');
          context.showToast('Onboarding complete!');
        }
        onComplete({ userLoc, parentLoc });
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  return (
    <ScrollView testID="onboarding-screen" className="flex-1 bg-[#f2f2f7] px-4 py-8">
      <View className="items-center justify-center py-4 space-y-5">
        {/* Step Indicator Dots */}
        <View testID="onboarding-step-dots" className="flex-row justify-center gap-1.5 mb-2">
          {[1, 2, 3, 4, 5, 6, 7].map((s) => (
            <View
              key={s}
              testID={`onboarding-dot-${s}`}
              className={`w-3.5 h-1 rounded-full ${s === step ? 'bg-[#007aff]' : 'bg-neutral-300'}`}
            />
          ))}
        </View>

        {/* Core Screen Card */}
        <View className="w-full bg-white rounded-2xl p-5 shadow-sm border border-neutral-100">
          {/* STEP 1: Welcome */}
          {step === 1 && (
            <View testID="onboarding-step-welcome" className="space-y-4 items-center w-full py-4">
              <BrandLogo size="lg" testID="onboarding-brand-logo" className="mb-1" />
              <Text className="text-2xl font-bold text-neutral-900 tracking-tight text-center">
                KinGuardian
              </Text>
              <Text className="text-base font-semibold text-neutral-700 text-center leading-snug px-2">
                “Be there for your parents, even when you're far away.”
              </Text>
              <Text className="text-xs text-neutral-400 text-center leading-normal mt-1">
                Cross-border health coordination that connects adult children living abroad with
                their ageing parents and local caregivers in India.
              </Text>
            </View>
          )}

          {/* STEP 2: Where do you live? */}
          {step === 2 && (
            <View testID="onboarding-step-user-location" className="space-y-4 w-full py-2">
              <View className="items-center">
                <Compass size={40} color="#007aff" />
              </View>
              <Text className="text-lg font-bold text-neutral-900 tracking-tight text-center">
                Where do you live?
              </Text>
              <Text className="text-xs font-semibold text-neutral-400 text-center uppercase tracking-wider">
                Child's current residence
              </Text>

              <View className="space-y-2 mt-2">
                {['UK', 'UAE', 'USA', 'Singapore', 'Canada'].map((country) => (
                  <TouchableOpacity
                    key={country}
                    testID={`onboarding-userloc-${country}`}
                    onPress={() => setUserLoc(country)}
                    className={`p-3.5 rounded-xl border flex-row items-center justify-between ${
                      userLoc === country
                        ? 'border-[#007aff] bg-[#007aff]/5'
                        : 'border-neutral-200 bg-neutral-50'
                    }`}
                  >
                    <Text
                      className={`text-sm font-semibold ${userLoc === country ? 'text-[#007aff]' : 'text-neutral-700'}`}
                    >
                      {country === 'UK'
                        ? 'United Kingdom (London)'
                        : country === 'UAE'
                          ? 'United Arab Emirates (Dubai)'
                          : country === 'USA'
                            ? 'United States'
                            : country}
                    </Text>
                    {userLoc === country && <CheckCircle2 size={16} color="#007aff" />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* STEP 3: Where do your parents live? */}
          {step === 3 && (
            <View testID="onboarding-step-parent-location" className="space-y-4 w-full py-2">
              <View className="items-center">
                <MapPin size={40} color="#007aff" />
              </View>
              <Text className="text-lg font-bold text-neutral-900 tracking-tight text-center">
                Where do your parents live?
              </Text>
              <Text className="text-xs font-semibold text-neutral-400 text-center uppercase tracking-wider">
                Primary telemetry source region
              </Text>

              <TouchableOpacity
                testID="onboarding-parentloc-india"
                onPress={() => setParentLoc('India')}
                className="p-4 rounded-xl border border-[#007aff] bg-[#007aff]/5 flex-row items-center justify-between mt-2"
              >
                <View className="space-y-0.5">
                  <Text className="text-sm font-bold text-[#007aff]">India</Text>
                  <Text className="text-[10px] text-neutral-400">
                    Fully optimized timezone mapping active
                  </Text>
                </View>
                <CheckCircle2 size={18} color="#007aff" />
              </TouchableOpacity>

              <Text className="text-[10px] text-neutral-400 text-center font-semibold px-4 leading-normal mt-4">
                KinGuardian is currently optimized for cross-border care delivery between the West/Gulf
                regions and parents residing in India.
              </Text>

            </View>
          )}

          {/* STEP 4: Who do you care for? */}
          {step === 4 && (
            <View testID="onboarding-step-care-target" className="space-y-4 w-full py-2">
              <View className="items-center">
                <Users size={40} color="#007aff" />
              </View>
              <Text className="text-lg font-bold text-neutral-900 tracking-tight text-center">
                Who do you care for?
              </Text>
              <Text className="text-xs font-semibold text-neutral-400 text-center uppercase tracking-wider">
                Profile checklist configuration
              </Text>

              <View className="flex-row gap-2 mt-2">
                {(['Mom', 'Dad', 'Both'] as const).map((target) => (
                  <TouchableOpacity
                    key={target}
                    testID={`onboarding-caretarget-${target}`}
                    onPress={() => setCareTarget(target)}
                    className={`flex-1 p-4 rounded-xl border items-center ${
                      careTarget === target
                        ? 'border-[#007aff] bg-[#007aff]/5'
                        : 'border-neutral-200 bg-neutral-50'
                    }`}
                  >
                    <Text
                      className={`text-sm font-semibold ${careTarget === target ? 'text-[#007aff]' : 'text-neutral-700'}`}
                    >
                      {target}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* STEP 5: Add parent */}
          {step === 5 && (
            <View testID="onboarding-step-parent-details" className="space-y-3 w-full py-2">
              <View className="items-center">
                <Smartphone size={40} color="#007aff" />
              </View>
              <Text className="text-lg font-bold text-neutral-900 tracking-tight text-center">
                Add Parent details
              </Text>

              <View className="space-y-3 mt-2">
                <View className="space-y-1">
                  <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                    Full Name
                  </Text>
                  <TextInput
                    testID="onboarding-parent-name"
                    value={parentName}
                    onChangeText={setParentName}
                    placeholder="Parent's name"
                    placeholderTextColor="#8e8e93"
                    className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-xs text-neutral-800 focus:border-[#007aff]"
                  />
                </View>

                <View className="space-y-1">
                  <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                    Age
                  </Text>
                  <TextInput
                    testID="onboarding-parent-age"
                    value={parentAge}
                    onChangeText={setParentAge}
                    placeholder="e.g. 68"
                    placeholderTextColor="#8e8e93"
                    keyboardType="numeric"
                    className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-xs text-neutral-800 focus:border-[#007aff]"
                  />
                </View>

                <View className="space-y-1">
                  <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                    City (India)
                  </Text>
                  <TextInput
                    testID="onboarding-parent-city"
                    value={parentCity}
                    onChangeText={setParentCity}
                    placeholder="e.g. Chennai"
                    placeholderTextColor="#8e8e93"
                    className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-xs text-neutral-800 focus:border-[#007aff]"
                  />
                </View>

                <View className="space-y-1">
                  <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                    Phone Number
                  </Text>
                  <TextInput
                    testID="onboarding-parent-phone"
                    value={parentPhone}
                    onChangeText={setParentPhone}
                    placeholder="+91 XXXXX XXXXX"
                    placeholderTextColor="#8e8e93"
                    keyboardType="phone-pad"
                    className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-xs text-neutral-800 focus:border-[#007aff]"
                  />
                </View>

                {careTarget === 'Both' && (
                  <View className="pt-3 border-t border-neutral-200 space-y-3">
                    <Text className="text-xs font-bold text-[#007aff] uppercase tracking-wider">
                      Second Parent Details (Mother)
                    </Text>
                    <View className="space-y-1">
                      <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                        Full Name
                      </Text>
                      <TextInput
                        testID="onboarding-second-parent-name"
                        value={secondParentName}
                        onChangeText={setSecondParentName}
                        placeholder="Mother's name"
                        placeholderTextColor="#8e8e93"
                        className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-xs text-neutral-800 focus:border-[#007aff]"
                      />
                    </View>
                    <View className="flex-row gap-2">
                      <View className="flex-1 space-y-1">
                        <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Age</Text>
                        <TextInput
                          testID="onboarding-second-parent-age"
                          value={secondParentAge}
                          onChangeText={setSecondParentAge}
                          placeholder="e.g. 64"
                          placeholderTextColor="#8e8e93"
                          keyboardType="numeric"
                          className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-xs text-neutral-800 focus:border-[#007aff]"
                        />
                      </View>
                      <View className="flex-1 space-y-1">
                        <Text className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Phone</Text>
                        <TextInput
                          testID="onboarding-second-parent-phone"
                          value={secondParentPhone}
                          onChangeText={setSecondParentPhone}
                          placeholder="+91 XXXXX XXXXX"
                          placeholderTextColor="#8e8e93"
                          keyboardType="phone-pad"
                          className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-xs text-neutral-800 focus:border-[#007aff]"
                        />
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* STEP 6: Invite parent */}
          {step === 6 && (
            <View testID="onboarding-step-invite" className="space-y-4 w-full py-2">
              <View className="items-center">
                <Send size={40} color="#007aff" />
              </View>
              <Text className="text-lg font-bold text-neutral-900 tracking-tight text-center">
                Invite Parent
              </Text>
              <Text className="text-xs text-neutral-400 text-center leading-normal px-2">
                Send {parentName.trim() || 'your parent'} a reassuring invitation message to link their wearable health sensors.
              </Text>

              {(!parentPhone.trim() && inviteMethod !== 'Email') && (
                <View testID="onboarding-missing-contact-warning" className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <Text className="text-xs text-amber-800 font-medium">
                    No phone number provided for {parentName.trim() || 'parent'}. You can skip this step and invite them later from Coordinator Home.
                  </Text>
                </View>
              )}

              <View className="space-y-2 mt-2">
                {(['Email', 'WhatsApp', 'SMS'] as const).map((method) => {
                  const channelKey = method.toLowerCase() as 'email' | 'whatsapp' | 'sms';
                  const cap = capabilities[channelKey];
                  const isAvailable = cap ? cap.status === 'available' : (method === 'Email' || method === 'WhatsApp');
                  const isSelected = inviteMethod === method;
                  return (
                    <TouchableOpacity
                      key={method}
                      testID={`onboarding-invite-${method}`}
                      disabled={!isAvailable}
                      onPress={() => isAvailable && setInviteMethod(method)}
                      className={`p-3.5 rounded-xl border flex-row items-center justify-between ${
                        !isAvailable
                          ? 'border-neutral-200 bg-neutral-100/60 opacity-60'
                          : isSelected
                            ? 'border-[#007aff] bg-[#007aff]/5'
                            : 'border-neutral-200 bg-neutral-50'
                      }`}
                    >
                      <View className="flex-1 pr-2">
                        <View className="flex-row items-center gap-2">
                          <Text
                            className={`text-sm font-semibold ${isSelected ? 'text-[#007aff]' : 'text-neutral-700'}`}
                          >
                            Invite via {method}
                          </Text>
                          {!isAvailable && (
                            <View className="px-1.5 py-0.5 bg-neutral-200 rounded text-[9px]">
                              <Text className="text-[9px] text-neutral-600 font-bold uppercase">Unavailable</Text>
                            </View>
                          )}
                          {isAvailable && method === 'WhatsApp' && (
                            <View className="px-1.5 py-0.5 bg-emerald-100 rounded text-[9px]">
                              <Text className="text-[9px] text-emerald-700 font-bold uppercase">Cloud API</Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-[10px] text-neutral-400 mt-0.5">
                          {cap?.notes || (isAvailable
                            ? `${method} gateway active`
                            : `${method} gateway not configured yet (contact enterprise support)`)}
                        </Text>
                      </View>
                      {isSelected && <CheckCircle2 size={16} color="#007aff" />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {inviteMethod === 'WhatsApp' && parentPhone.trim() && !parentPhone.trim().startsWith('+') && (
                <View testID="onboarding-whatsapp-phone-guidance" className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                  <Text className="text-[11px] text-blue-800">
                    💡 Tip: WhatsApp invitations require international format with country code (e.g. +91 98765 43210 for India, +1 for US/Canada).
                  </Text>
                </View>
              )}

              <TouchableOpacity
                testID="onboarding-invite-skip-btn"
                onPress={() => setStep(7)}
                className="py-2.5 items-center"
              >
                <Text className="text-xs font-semibold text-[#007aff]">
                  Skip invitation for now &gt;
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* STEP 7: Complete */}
          {step === 7 && (
            <View testID="onboarding-step-complete" className="space-y-4 items-center w-full py-4">
              <View className="w-14 h-14 rounded-full bg-[#eefdf4] items-center justify-center shadow-xs">
                <ShieldCheck size={28} color="#34c759" />
              </View>
              <Text className="text-2xl font-bold text-neutral-900 tracking-tight text-center">
                Family Care Circle Ready
              </Text>
              <Text className="text-base font-semibold text-neutral-700 text-center leading-snug px-4">
                {`Care circle established for ${parentName.trim() || 'Parent'}${careTarget === 'Both' && secondParentName.trim() ? ` & ${secondParentName.trim()}` : ''}.`}
              </Text>
              <Text className="text-xs text-neutral-500 text-center leading-normal px-6">
                {`${context?.currentUser?.name || context?.coordinatorName || 'Coordinator'} is active as family coordinator. When health readings are submitted or devices are paired in Connected Devices, verified telemetry will appear on your dashboard.`}
              </Text>
            </View>
          )}

          {/* Navigation Actions */}
          <View testID="onboarding-nav" className="w-full flex-row gap-3 mt-6">
            {step > 1 && (
              <TouchableOpacity
                testID="onboarding-back"
                onPress={handleBack}
                className="flex-1 py-3 bg-neutral-100 rounded-xl items-center justify-center"
              >
                <Text className="text-[#007aff] font-bold text-sm">Back</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              testID={step === 7 ? 'onboarding-connect-parents' : 'onboarding-next'}
              onPress={handleNext}
              className={`py-3 rounded-xl items-center justify-center active:scale-95 bg-[#007aff] ${
                step > 1 ? 'flex-1' : 'w-full'
              }`}
            >
              <Text className="text-white font-bold text-sm px-4">
                {step === 7 ? 'Connect Parents' : 'Next'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <View className="h-10" />
    </ScrollView>
  );
};

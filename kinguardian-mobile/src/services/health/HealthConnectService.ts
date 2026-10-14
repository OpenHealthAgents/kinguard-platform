/**
 * Real Android Health Connect Service.
 *
 * Directly connects to the on-device Health Connect application to fetch
 * actual step counts, heart rate readings, and sleep sessions recorded by Google Fit,
 * Samsung Health, or Wear OS devices on Android.
 */

import { Platform } from 'react-native';

export interface RealHealthConnectData {
  steps: number;
  heartRate: number;
  sleepMinutes: number;
  source: string;
  isRealDeviceData: boolean;
  rawDataDetails?: string;
}

export class HealthConnectService {
  private isInitialized = false;

  private isAvailableChecked = false;
  private isModuleAvailable = false;

  /**
   * Safely checks if Health Connect SDK is supported and linked on this device.
   * Prevents crashes or yellow box warnings when running in Expo Go or Web.
   */
  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    if (this.isAvailableChecked) return this.isModuleAvailable;

    try {
      // Dynamic require so non-native or web environments don't crash
      const HealthConnect = require('react-native-health-connect');
      if (!HealthConnect || typeof HealthConnect.getSdkStatus !== 'function') {
        this.isAvailableChecked = true;
        this.isModuleAvailable = false;
        return false;
      }
      const status = await HealthConnect.getSdkStatus();
      // SDK_AVAILABLE is 3
      const available = status === 3 || status === HealthConnect.SdkAvailabilityStatus?.SDK_AVAILABLE;
      this.isAvailableChecked = true;
      this.isModuleAvailable = available;
      return available;
    } catch (e: any) {
      this.isAvailableChecked = true;
      this.isModuleAvailable = false;
      // Do not log warning if it is simply running in Expo Go or an unlinked dev client
      if (!e?.message?.includes("doesn't seem to be linked") && !e?.message?.includes('Expo Go')) {
        console.warn('Health Connect not available on this runtime:', e);
      }
      return false;
    }
  }

  /**
   * Initializes the native Health Connect client and requests runtime permissions.
   */
  async initializeAndAuthorize(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    const available = await this.isAvailable();
    if (!available) return false;

    try {
      const HealthConnect = require('react-native-health-connect');
      const initialized = await HealthConnect.initialize();
      if (!initialized) return false;
      this.isInitialized = true;

      // Request Health Connect permissions
      const requestedPermissions = [
        { accessType: 'read', recordType: 'Steps' },
        { accessType: 'read', recordType: 'HeartRate' },
        { accessType: 'read', recordType: 'SleepSession' }
      ];
      const granted = await HealthConnect.requestPermission(requestedPermissions);
      const isGrantedArray = Array.isArray(granted);
      const hasAnyPermission = isGrantedArray && granted.length > 0;
      const hasAllPermissions = requestedPermissions.every((permission) =>
        granted?.some(
          (grantedPermission: { accessType?: string; recordType?: string }) =>
            grantedPermission.accessType === permission.accessType &&
            grantedPermission.recordType === permission.recordType
        )
      );
      if (!hasAllPermissions && hasAnyPermission) {
        console.log('Health Connect granted partial permissions for available data types.');
      }
      return hasAllPermissions || hasAnyPermission || isGrantedArray;
    } catch (e: any) {
      if (!e?.message?.includes("doesn't seem to be linked") && !e?.message?.includes('Expo Go')) {
        console.warn('Health Connect authorization error:', e);
      }
      return false;
    }
  }

  /**
   * Reads real-time telemetry directly from the Android Health Connect store.
   * If Google Fit is syncing into Health Connect, this retrieves the true Google Fit data.
   */
  async fetchRealTelemetry(): Promise<RealHealthConnectData | null> {
    if (Platform.OS !== 'android') return null;

    // Safely check if native module is available (avoids Expo Go unlinked warnings)
    const available = await this.isAvailable();
    if (!available) return null;

    try {
      const HealthConnect = require('react-native-health-connect');
      if (!this.isInitialized) {
        await HealthConnect.initialize();
        this.isInitialized = true;
      }

      const now = new Date();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // 1. Fetch real step count records for today
      let totalSteps = 0;
      let stepCountFromAgg = false;

      try {
        if (typeof HealthConnect.aggregateRecord === 'function') {
          const agg = await HealthConnect.aggregateRecord({
            recordType: 'Steps',
            timeRangeFilter: {
              operator: 'between',
              startTime: startOfDay.toISOString(),
              endTime: now.toISOString()
            }
          });
          if (agg && typeof agg.COUNT_TOTAL === 'number' && agg.COUNT_TOTAL > 0) {
            totalSteps = agg.COUNT_TOTAL;
            stepCountFromAgg = true;
          }
        }
      } catch (aggErr) {
        // Fallback to reading raw records
      }

      let stepRecords: any[] = [];
      if (!stepCountFromAgg) {
        try {
          const stepsResponse = await HealthConnect.readRecords('Steps', {
            timeRangeFilter: {
              operator: 'between',
              startTime: startOfDay.toISOString(),
              endTime: now.toISOString()
            }
          });
          stepRecords = stepsResponse?.records || [];
          totalSteps = stepRecords.reduce((sum: number, rec: any) => sum + (rec.count || 0), 0);
        } catch {}
      }

      // 2. Fetch real heart rate records for today
      let latestHr = 0;
      try {
        if (typeof HealthConnect.aggregateRecord === 'function') {
          const hrAgg = await HealthConnect.aggregateRecord({
            recordType: 'HeartRate',
            timeRangeFilter: {
              operator: 'between',
              startTime: startOfDay.toISOString(),
              endTime: now.toISOString()
            }
          });
          if (hrAgg && typeof hrAgg.BPM_AVG === 'number' && hrAgg.BPM_AVG > 0) {
            latestHr = Math.round(hrAgg.BPM_AVG);
          }
        }
      } catch {}

      if (latestHr === 0) {
        try {
          const hrResponse = await HealthConnect.readRecords('HeartRate', {
            timeRangeFilter: {
              operator: 'between',
              startTime: startOfDay.toISOString(),
              endTime: now.toISOString()
            }
          });
          const hrRecords = hrResponse?.records || [];
          if (hrRecords.length > 0) {
            const lastRec = hrRecords[hrRecords.length - 1];
            if (lastRec.samples && lastRec.samples.length > 0) {
              latestHr = lastRec.samples[lastRec.samples.length - 1].beatsPerMinute || 0;
            }
          }
        } catch {}
      }

      // 3. Fetch real sleep sessions (last 24h)
      const sleepStart = new Date(Date.now() - 24 * 3600 * 1000);
      let totalSleepMinutes = 0;

      try {
        if (typeof HealthConnect.aggregateRecord === 'function') {
          const sleepAgg = await HealthConnect.aggregateRecord({
            recordType: 'SleepSession',
            timeRangeFilter: {
              operator: 'between',
              startTime: sleepStart.toISOString(),
              endTime: now.toISOString()
            }
          });
          if (sleepAgg && typeof sleepAgg.SLEEP_DURATION_TOTAL === 'number' && sleepAgg.SLEEP_DURATION_TOTAL > 0) {
            totalSleepMinutes = Math.round(sleepAgg.SLEEP_DURATION_TOTAL / 60);
          }
        }
      } catch {}

      if (totalSleepMinutes === 0) {
        try {
          const sleepResponse = await HealthConnect.readRecords('SleepSession', {
            timeRangeFilter: {
              operator: 'between',
              startTime: sleepStart.toISOString(),
              endTime: now.toISOString()
            }
          });
          const sleepRecords = sleepResponse?.records || [];
          for (const rec of sleepRecords) {
            if (rec.startTime && rec.endTime) {
              const diffMs = new Date(rec.endTime).getTime() - new Date(rec.startTime).getTime();
              totalSleepMinutes += Math.max(0, Math.round(diffMs / 60000));
            }
          }
        } catch {}
      }

      return {
        steps: totalSteps,
        heartRate: latestHr,
        sleepMinutes: totalSleepMinutes,
        source: 'health_connect',
        isRealDeviceData: true,
        rawDataDetails: `Real sync: Read ${totalSteps} steps, ${latestHr} bpm, and ${totalSleepMinutes} sleep mins from Health Connect.`
      };
    } catch (e: any) {
      if (!e?.message?.includes("doesn't seem to be linked") && !e?.message?.includes('Expo Go')) {
        console.warn('Error reading from Health Connect:', e);
      }
      return null;
    }
  }
}

export const healthConnectService = new HealthConnectService();

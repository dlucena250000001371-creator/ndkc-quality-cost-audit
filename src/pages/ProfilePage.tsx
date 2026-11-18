import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Save, UserCircle2 } from 'lucide-react';
import {
  OperationType,
  db,
  handleFirestoreError,
  stripUndefined,
  withTimeout,
} from '../lib/firebase';
import type { RoleCategory, UserProfile } from '../types/audit';

const ROLE_OPTIONS: RoleCategory[] = [
  'Faculty',
  'Academic Administrator',
  'Support Office',
];

interface ProfilePageProps {
  uid: string;
  authDisplayName: string;
  authPhotoURL: string;
  profile: UserProfile | null;
  profileLoading: boolean;
  onSaved: () => void;
  onNotify: (toast: {
    type: 'error' | 'success' | 'info';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => void;
}

export function ProfilePage({
  uid,
  authDisplayName,
  authPhotoURL,
  profile,
  profileLoading,
  onSaved,
  onNotify,
}: ProfilePageProps) {
  const [office, setOffice] = useState('');
  const [roleCategory, setRoleCategory] = useState<RoleCategory>('Faculty');
  const [position, setPosition] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [yearsInRole, setYearsInRole] = useState('0');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reload fields from saved document every time Profile is opened or profile updates
  useEffect(() => {
    if (profile) {
      setOffice(profile.office || '');
      setRoleCategory(profile.roleCategory || 'Faculty');
      setPosition(profile.position || '');
      setJobDescription(profile.jobDescription || '');
      setYearsInRole(String(profile.yearsInRole ?? 0));
    } else {
      setOffice('');
      setRoleCategory('Faculty');
      setPosition('');
      setJobDescription('');
      setYearsInRole('0');
    }
  }, [profile]);

  const validateAndBuildPayload = () => {
    const cleanOffice = office.trim();
    const cleanPosition = position.trim();
    const cleanJobDesc = jobDescription.trim();
    const parsedYears = Number(yearsInRole);

    if (!cleanOffice || cleanOffice.length > 120) {
      return { error: 'Department or office is required (max 120 characters).' };
    }
    if (!ROLE_OPTIONS.includes(roleCategory)) {
      return { error: 'Please select a valid role category.' };
    }
    if (!cleanPosition || cleanPosition.length > 120) {
      return { error: 'Position is required (max 120 characters).' };
    }
    if (!cleanJobDesc || cleanJobDesc.length > 1000) {
      return { error: 'Job description is required (max 1000 characters).' };
    }
    if (
      yearsInRole.trim() === '' ||
      !Number.isInteger(parsedYears) ||
      parsedYears < 0 ||
      parsedYears > 50
    ) {
      return { error: 'Years in role must be a whole number between 0 and 50.' };
    }

    return {
      error: null,
      data: {
        uid,
        displayName: (authDisplayName || 'NDKC Employee').trim().slice(0, 120),
        photoURL: (authPhotoURL || '').trim().slice(0, 1000),
        office: cleanOffice,
        roleCategory,
        position: cleanPosition,
        jobDescription: cleanJobDesc,
        yearsInRole: parsedYears,
      },
    };
  };

  const executeSave = async () => {
    const validated = validateAndBuildPayload();
    if (validated.error || !validated.data) {
      setFormError(validated.error || 'Please check your profile fields.');
      return;
    }

    if (!navigator.onLine) {
      setFormError('You appear to be offline. Please reconnect and try again.');
      onNotify({
        type: 'error',
        message: 'Cannot save profile while offline.',
        actionLabel: 'Retry Save',
        onAction: () => void executeSave(),
      });
      return;
    }

    setFormError(null);
    setSaving(true);
    const userRef = doc(db, 'users', uid);

    try {
      if (profile) {
        const updatePayload = stripUndefined({
          ...validated.data,
          updatedAt: serverTimestamp(),
        });
        await withTimeout(updateDoc(userRef, updatePayload), 15000, 'Profile save timed out.');
      } else {
        const createPayload = stripUndefined({
          ...validated.data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await withTimeout(setDoc(userRef, createPayload), 15000, 'Profile save timed out.');
      }

      onNotify({
        type: 'success',
        message: 'Employee profile saved.',
      });
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save profile.';
      setFormError(msg);
      onNotify({
        type: 'error',
        message: 'Failed to save profile. Your entries are preserved.',
        actionLabel: 'Retry Save',
        onAction: () => void executeSave(),
      });
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeSave();
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-6 md:p-8 space-y-6 animate-fade-rise">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-full bg-blue-50 text-[#1E40AF] flex items-center justify-center shrink-0 mt-0.5">
            <UserCircle2 className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold text-slate-900">Employee Profile</h1>
            <p className="text-sm text-slate-600">
              Used to tailor the Audit Partner&apos;s questions to your NDKC office and role.
              Email addresses are never stored in the database.
            </p>
          </div>
        </div>

        {profileLoading ? (
          <div className="space-y-4">
            <div className="h-10 bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-10 bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {formError && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
              >
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="profile-office" className="block text-sm font-bold text-slate-800">
                  Department or Office
                </label>
                <input
                  id="profile-office"
                  type="text"
                  maxLength={120}
                  value={office}
                  onChange={(e) => setOffice(e.target.value)}
                  placeholder="e.g., College of Arts and Sciences, Registrar"
                  className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="profile-role" className="block text-sm font-bold text-slate-800">
                  Role Category
                </label>
                <select
                  id="profile-role"
                  value={roleCategory}
                  onChange={(e) => setRoleCategory(e.target.value as RoleCategory)}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <label htmlFor="profile-position" className="block text-sm font-bold text-slate-800">
                  Position / Title
                </label>
                <input
                  id="profile-position"
                  type="text"
                  maxLength={120}
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="e.g., Assistant Professor, Admissions Officer"
                  className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="profile-years" className="block text-sm font-bold text-slate-800">
                  Years in Role (0–50)
                </label>
                <input
                  id="profile-years"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={yearsInRole}
                  onChange={(e) => setYearsInRole(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="profile-jobdesc" className="block text-sm font-bold text-slate-800">
                  Job Description
                </label>
                <span className="text-xs text-slate-500 tabular-nums">
                  {jobDescription.length} / 1000
                </span>
              </div>
              <textarea
                id="profile-jobdesc"
                rows={4}
                maxLength={1000}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Briefly describe your main responsibilities and regular outputs."
                className="w-full px-3.5 py-2.5 text-sm border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="btn-royal px-6 py-2.5 disabled:opacity-60 font-bold text-sm rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Saving...' : 'Save Profile'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

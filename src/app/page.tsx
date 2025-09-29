'use client';

import { useState, useEffect } from 'react';

interface Profile {
  id: string;
  attributes: {
    email?: string;
    first_name?: string;
    last_name?: string;
    subscription_status?: 'subscribed' | 'unsubscribed' | 'pending' | string;
  };
}

interface KlaviyoList {
  id: string;
  name: string;
}

// Basic dynamic field shape we render from the Klaviyo form JSON
type DynFieldType = 'email' | 'text' | 'checkbox';
interface DynField {
  key: string; // unique key per field
  name: string; // source name/id in Klaviyo form
  label: string;
  type: DynFieldType;
  required?: boolean;
}

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Add Profile modal & form state (static fallback)
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [subscribe, setSubscribe] = useState(false);
  const [listId, setListId] = useState('');
  const [useCustomList, setUseCustomList] = useState(false);
  const [customListId, setCustomListId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Klaviyo form definition (drives title/teaser and dynamic fields)
  const [formDef, setFormDef] = useState<any | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formLoadError, setFormLoadError] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState<string>('Add Profile');
  const [formTeaserHtml, setFormTeaserHtml] = useState<string | null>(null);
  const [dynamicFields, setDynamicFields] = useState<DynField[]>([]);
  const [dynamicValues, setDynamicValues] = useState<Record<string, any>>({});

  // Dynamic lists
  const [lists, setLists] = useState<KlaviyoList[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);

  // Sorting
  type SortKey = 'id' | 'email' | 'first_name' | 'last_name' | 'status';
  const [sortBy, setSortBy] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: SortKey) => {
    setSortBy((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir('asc');
      return key;
    });
  };

  const getArrow = (key: SortKey) => {
    if (sortBy !== key) return '↕';
    return sortDir === 'asc' ? '▲' : '▼';
  };

  const sortedProfiles = (() => {
    const copy = [...profiles];
    copy.sort((a, b) => {
      const av = (
        sortBy === 'id'
          ? a.id
          : sortBy === 'email'
          ? (a.attributes.email || '')
          : sortBy === 'first_name'
          ? (a.attributes.first_name || '')
          : sortBy === 'last_name'
          ? (a.attributes.last_name || '')
          : (a.attributes.subscription_status || '')
      )?.toString().toLowerCase();
      const bv = (
        sortBy === 'id'
          ? b.id
          : sortBy === 'email'
          ? (b.attributes.email || '')
          : sortBy === 'first_name'
          ? (b.attributes.first_name || '')
          : sortBy === 'last_name'
          ? (b.attributes.last_name || '')
          : (b.attributes.subscription_status || '')
      )?.toString().toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  })();

  // Fetch profiles (reusable)
  const fetchProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/profiles');
      if (!response.ok) {
        throw new Error('Failed to fetch profiles');
      }
      const data = await response.json();
      setProfiles(data.data || []);
    } catch (err) {
      console.error('Error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Helper: attempt to extract all elements arrays from a step
  function extractElements(step: any): any[] {
    if (!step || typeof step !== 'object') return [];
    const candidates = [step.fields, step.elements, step.components, step.items, step.children];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length) return c;
    }
    return [];
  }

  // Helper: infer a DynField from an element of unknown schema
  function elementToField(el: any, idx: number): DynField | null {
    if (!el || typeof el !== 'object') return null;
    const rawType = (el.type || el.kind || el.component || '').toString().toLowerCase();
    const name = (el.name || el.id || el.key || `field_${idx}`).toString();
    const label = (el.label || el.title || el.placeholder || name).toString();

    let type: DynFieldType | null = null;
    if (rawType.includes('email')) type = 'email';
    else if (rawType.includes('checkbox') || rawType.includes('consent')) type = 'checkbox';
    else if (rawType.includes('text') || rawType.includes('input') || rawType === '') type = 'text';

    // If not inferred by type, check name-based hints
    if (!type) {
      const lname = name.toLowerCase();
      if (lname.includes('email')) type = 'email';
      else if (lname.includes('first') || lname.includes('last') || lname.includes('name')) type = 'text';
      else if (lname.includes('consent') || lname.includes('subscribe')) type = 'checkbox';
    }

    if (!type) return null;

    const required = Boolean(el.required || el.is_required || el.rules?.required);
    return { key: `${name}_${idx}`, name, label, type, required };
  }

  // Parse and set dynamic fields from a form version
  function parseDynamicFieldsFromVersion(version: any) {
    const fields: DynField[] = [];
    const steps: any[] = Array.isArray(version?.steps) ? version.steps : [];
    steps.forEach((step, sIdx) => {
      const els = extractElements(step);
      els.forEach((el: any, eIdx: number) => {
        const f = elementToField(el, sIdx * 100 + eIdx);
        if (f) fields.push(f);
      });
    });

    // De-duplicate by name, prefer first occurrence
    const seen = new Set<string>();
    const deduped = fields.filter((f) => {
      if (seen.has(f.name)) return false;
      seen.add(f.name);
      return true;
    });

    setDynamicFields(deduped);
    // Initialize values if empty
    setDynamicValues((prev) => {
      const next = { ...prev };
      for (const f of deduped) {
        if (next[f.name] === undefined) next[f.name] = f.type === 'checkbox' ? false : '';
      }
      return next;
    });
  }

  // Fetch lists and form when opening modal
  useEffect(() => {
    const fetchLists = async () => {
      setListsLoading(true);
      setListsError(null);
      try {
        const res = await fetch('/api/lists', { cache: 'no-store' });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || 'Failed to load lists');
        }
        const json = await res.json();
        setLists(Array.isArray(json?.data) ? json.data : []);
      } catch (e) {
        console.error('Lists fetch error:', e);
        setListsError(e instanceof Error ? e.message : 'Failed to load lists');
      } finally {
        setListsLoading(false);
      }
    };

    const fetchFormDef = async () => {
      setFormLoading(true);
      setFormLoadError(null);
      try {
        const res = await fetch('/api/form', { cache: 'no-store' });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || 'Failed to load form definition');
        }
        const json = await res.json();
        setFormDef(json);

        const baseTitle = json?.data?.attributes?.name;
        const versions: any[] = json?.data?.attributes?.definition?.versions || [];
        const preferred =
          versions.find((v: any) => (v?.name || '').toLowerCase().includes('embed')) ||
          versions[versions.length - 1] || null;
        const teaserHtml = preferred?.teaser?.content || null;
        setFormTitle(baseTitle || preferred?.name || 'Add Profile');
        setFormTeaserHtml(typeof teaserHtml === 'string' ? teaserHtml : null);

        if (preferred) parseDynamicFieldsFromVersion(preferred);
      } catch (e) {
        console.error('Form definition fetch error:', e);
        setFormLoadError(e instanceof Error ? e.message : 'Failed to load form');
        setFormTitle('Add Profile');
        setFormTeaserHtml(null);
        setDynamicFields([]);
      } finally {
        setFormLoading(false);
      }
    };

    if (isAddOpen) {
      fetchLists();
      fetchFormDef();
    }
  }, [isAddOpen]);

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setEmail('');
    setSubscribe(false);
    setListId('');
    setUseCustomList(false);
    setCustomListId('');
    setFormError(null);
    // keep dynamic parsed UI as-is while modal open
  };

  // Map dynamicValues into our payload fields
  function projectPayloadFromDynamic(values: Record<string, any>) {
    const entries = Object.entries(values);
    const findBy = (pred: (n: string) => boolean) => {
      const hit = entries.find(([n]) => pred(n.toLowerCase()));
      return hit ? hit[1] : undefined;
    };

    const emailVal = findBy((n) => n.includes('email'));
    const firstVal = findBy((n) => n.includes('first'));
    const lastVal = findBy((n) => n.includes('last'));
    const subscribeVal = !!findBy((n) => n.includes('subscribe') || n.includes('consent'));

    return {
      email: typeof emailVal === 'string' ? emailVal : '',
      first_name: typeof firstVal === 'string' ? firstVal : undefined,
      last_name: typeof lastVal === 'string' ? lastVal : undefined,
      subscribe: subscribeVal,
    };
  }

  const onSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();

    // If we have dynamic fields, prefer them; otherwise use static inputs
    let payloadEmail = email;
    let payloadFirst = firstName || undefined;
    let payloadLast = lastName || undefined;
    let payloadSubscribe = subscribe;

    if (dynamicFields.length > 0) {
      const proj = projectPayloadFromDynamic(dynamicValues);
      payloadEmail = proj.email || payloadEmail;
      payloadFirst = proj.first_name ?? payloadFirst;
      payloadLast = proj.last_name ?? payloadLast;
      payloadSubscribe = proj.subscribe;
    }

    if (!payloadEmail) {
      setFormError('Email is required');
      return;
    }

    const chosenListId = useCustomList ? customListId.trim() : listId.trim();
    if (payloadSubscribe && !chosenListId) {
      setFormError('Please select or enter a Klaviyo List ID to subscribe.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: payloadEmail,
          first_name: payloadFirst,
          last_name: payloadLast,
          subscribe: payloadSubscribe,
          list_id: payloadSubscribe ? chosenListId : undefined,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || 'Failed to add profile');
      }
      // Success: close and refresh
      setIsAddOpen(false);
      resetForm();
      await fetchProfiles();
    } catch (err) {
      console.error('Add profile failed:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to add profile');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <p>Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Klaviyo Profiles</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddOpen(true)}
            className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Add Profile
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('id')}>
                <span className="inline-flex items-center gap-1">ID <span className="text-gray-400">{getArrow('id')}</span></span>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('email')}>
                <span className="inline-flex items-center gap-1">Email <span className="text-gray-400">{getArrow('email')}</span></span>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('first_name')}>
                <span className="inline-flex items-center gap-1">First Name <span className="text-gray-400">{getArrow('first_name')}</span></span>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('last_name')}>
                <span className="inline-flex items-center gap-1">Last Name <span className="text-gray-400">{getArrow('last_name')}</span></span>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('status')}>
                <span className="inline-flex items-center gap-1">Status <span className="text-gray-400">{getArrow('status')}</span></span>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedProfiles.length > 0 ? (
              sortedProfiles.map((profile) => {
                const status = (profile.attributes.subscription_status || '').toLowerCase();
                const isSubscribed = status === 'subscribed';
                const isPending = status === 'pending';
                return (
                  <tr key={profile.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {profile.id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {profile.attributes.email || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {profile.attributes.first_name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {profile.attributes.last_name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span
                        className={
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                          (isSubscribed
                            ? 'bg-green-100 text-green-800'
                            : isPending
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800')
                        }
                      >
                        {isSubscribed ? 'Subscribed' : isPending ? 'Pending' : 'Not Subscribed'}
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">
                  No profiles found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Profile Modal */}
      {isAddOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-title"
          aria-describedby="add-desc"
          onClick={() => setIsAddOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 id="add-title" className="text-lg font-semibold text-gray-900">
                {formTitle}
              </h2>
            </div>
            {formLoading && (
              <div className="px-5 pt-3 text-xs text-gray-500">Loading form…</div>
            )}
            {formLoadError && (
              <div className="mx-5 mt-3 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                {formLoadError}
              </div>
            )}
            {formTeaserHtml && (
              <div className="px-5 pt-3 text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: formTeaserHtml }} />
            )}
            <form onSubmit={onSubmitAdd} className="px-5 py-4 space-y-4">
              {formError && (
                <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}

              {/* Dynamic fields (if available), else fallback to static inputs */}
              {dynamicFields.length > 0 ? (
                <div className="space-y-3">
                  {dynamicFields.map((f) => (
                    <div key={f.key}>
                      {f.type !== 'checkbox' && (
                        <label className="block text-sm font-medium text-gray-700">
                          {f.label}
                          {f.required && <span className="text-red-500"> *</span>}
                        </label>
                      )}
                      {f.type === 'text' || f.type === 'email' ? (
                        <input
                          type={f.type}
                          value={dynamicValues[f.name] ?? ''}
                          onChange={(e) =>
                            setDynamicValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                          }
                          required={f.required}
                          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                          placeholder={f.label}
                        />
                      ) : f.type === 'checkbox' ? (
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={!!dynamicValues[f.name]}
                            onChange={(e) =>
                              setDynamicValues((prev) => ({ ...prev, [f.name]: e.target.checked }))
                            }
                            className="h-4 w-4"
                          />
                          {f.label}
                          {f.required && <span className="text-red-500"> *</span>}
                        </label>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">First Name</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      placeholder="Jane"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Last Name</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      placeholder="Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      placeholder="jane@example.com"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={subscribe}
                      onChange={(e) => setSubscribe(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Subscribe (double opt-in)
                  </label>
                </>
              )}

              {/* List selection (applies whether dynamic or static) */}
              <div className={(dynamicFields.length > 0 ? '' : '') + ' ' + (subscribe || dynamicFields.length > 0 ? 'block' : 'block')}>
                <label className="block text-sm font-medium text-gray-700">Klaviyo List</label>
                <div className="mt-1">
                  {listsLoading ? (
                    <div className="text-xs text-gray-500">Loading lists…</div>
                  ) : listsError ? (
                    <div className="text-xs text-red-600">{listsError}</div>
                  ) : (
                    <select
                      value={useCustomList ? 'custom' : listId}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'custom') {
                          setUseCustomList(true);
                        } else {
                          setUseCustomList(false);
                          setListId(v);
                        }
                      }}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="">Select a list</option>
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                      <option value="custom">Custom…</option>
                    </select>
                  )}
                </div>
                {useCustomList && (
                  <input
                    type="text"
                    value={customListId}
                    onChange={(e) => setCustomListId(e.target.value)}
                    placeholder="Enter Klaviyo List ID"
                    className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                )}
                <p className="mt-1 text-xs text-gray-500">Required when Subscribe is checked.</p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddOpen(false);
                    resetForm();
                  }}
                  className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Adding…' : 'Add Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
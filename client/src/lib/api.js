let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

export function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const match = document.cookie.match(/(?:^|;\s*)minchat_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message || 'Something went wrong');
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'ERROR';
    this.details = details || null;
    this.requestId = requestId || null;
  }
}

async function parseResponse(res) {
  const type = res.headers.get('content-type') || '';
  if (res.status === 204) return null;
  if (type.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return await res.text();
}

export async function api(path, { method = 'GET', body, form, headers = {}, signal } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
    signal
  };

  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  if (method !== 'GET' && method !== 'HEAD') {
    const token = getCsrfToken();
    if (token) init.headers['X-CSRF-Token'] = token;
  }

  let res;
  try {
    res = await fetch(path.startsWith('/') ? path : `/api/${path}`, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach MinChat. Check your connection and try again.');
  }

  const data = await parseResponse(res);
  if (!res.ok) {
    const detail = data && typeof data === 'object' ? data.error : null;
    if (res.status === 401 && !path.includes('/auth/login')) {
      window.dispatchEvent(new CustomEvent('minchat:unauthorized'));
    }
    throw new ApiError(
      res.status,
      detail?.code || 'REQUEST_FAILED',
      detail?.message || `Request failed (${res.status})`,
      detail?.details || null,
      detail?.requestId || null
    );
  }
  return data;
}

export const get = (path, opts) => api(path, { ...opts, method: 'GET' });
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const patch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
export const del = (path, body, opts) => api(path, { ...opts, method: 'DELETE', body });

export function upload(path, file, fields = {}, { onProgress } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', file, file.name || 'upload');

  if (!onProgress) {
    return api(path, { method: 'POST', form });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    const token = getCsrfToken();
    if (token) xhr.setRequestHeader('X-CSRF-Token', token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        reject(
          new ApiError(
            xhr.status,
            data?.error?.code || 'UPLOAD_FAILED',
            data?.error?.message || 'Upload failed. Please try again.',
            data?.error?.details || null
          )
        );
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Upload failed. Check your connection.'));
    xhr.send(form);
  });
}

export const endpoints = {
  me: () => get('/api/users/me'),
  login: (identifier, password) => post('/api/auth/login', { identifier, password }),
  register: (data) => post('/api/auth/register', data),
  logout: () => post('/api/auth/logout'),
  forgot: (email) => post('/api/auth/password/forgot', { email }),
  reset: (token, password) => post('/api/auth/password/reset', { token, password }),
  changePassword: (currentPassword, newPassword) =>
    post('/api/auth/password/change', { currentPassword, newPassword }),
  sessions: () => get('/api/auth/sessions'),
  revokeSession: (id) => del(`/api/auth/sessions/${id}`),
  revokeOtherSessions: () => del('/api/auth/sessions'),
  deleteAccount: (password) => del('/api/auth/account', { password, confirmation: 'DELETE' }),
  conversations: () => get('/api/conversations'),
  conversation: (id) => get(`/api/conversations/${id}`),
  messages: (id, { before, limit = 50 } = {}) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    params.set('limit', String(limit));
    return get(`/api/conversations/${id}/messages?${params}`);
  },
  sendMessage: (id, payload) => post(`/api/conversations/${id}/messages`, payload),
  markRead: (id, messageId) => post(`/api/conversations/${id}/read`, { messageId }),
  direct: (userId) => post('/api/conversations/direct', { userId }),
  group: (name, memberIds) => post('/api/conversations/group', { name, memberIds }),
  updateGroup: (id, name) => patch(`/api/conversations/${id}`, { name }),
  groupMembers: (id, userIds) => post(`/api/conversations/${id}/members`, { userIds }),
  removeGroupMember: (id, userId) => del(`/api/conversations/${id}/members/${userId}`),
  leaveGroup: (id) => post(`/api/conversations/${id}/leave`),
  setMemberRole: (id, userId, role) => patch(`/api/conversations/${id}/members/${userId}`, { role }),
  conversationSettings: (id, data) => patch(`/api/conversations/${id}/settings`, data),
  editMessage: (id, body) => patch(`/api/messages/${id}`, { body }),
  deleteMessage: (id) => del(`/api/messages/${id}`),
  react: (id, emoji) => post(`/api/messages/${id}/reactions`, { emoji }),
  unreact: (id, emoji) => del(`/api/messages/${id}/reactions?emoji=${encodeURIComponent(emoji)}`),
  friends: () => get('/api/friends'),
  friendRequests: (direction) => get(`/api/friends/requests?direction=${direction}`),
  sendFriendRequest: (payload) => post('/api/friends/requests', payload),
  respondRequest: (id, action) => post(`/api/friends/requests/${id}/${action}`),
  removeFriend: (userId) => del(`/api/friends/${userId}`),
  blocks: () => get('/api/friends/blocks/list'),
  block: (userId) => post('/api/friends/blocks', { userId }),
  unblock: (userId) => del(`/api/friends/blocks/${userId}`),
  searchUsers: (q) => get(`/api/users/search?q=${encodeURIComponent(q)}`),
  profile: (username) => get(`/api/users/${encodeURIComponent(username)}`),
  updateProfile: (data) => patch('/api/users/me', data),
  updateSettings: (data) => patch('/api/users/me/settings', data),
  uploadAvatar: (file, onProgress) => upload('/api/users/me/avatar', file, {}, { onProgress }),
  removeAvatar: () => del('/api/users/me/avatar'),
  uploadGroupAvatar: (id, file, onProgress) =>
    upload(`/api/conversations/${id}/image`, file, {}, { onProgress }),
  uploadFile: (file, onProgress) => upload('/api/files', file, {}, { onProgress }),
  searchMessages: (q, conversationId) => {
    const params = new URLSearchParams({ q });
    if (conversationId) params.set('conversationId', conversationId);
    return get(`/api/search/messages?${params}`);
  },
  notifications: () => get('/api/notifications?limit=30'),
  notificationsUnread: () => get('/api/notifications/unread-count'),
  markNotificationsRead: (payload = {}) => post('/api/notifications/read', payload),
  pushKey: () => get('/api/notifications/push-key'),
  pushSubscribe: (subscription) => post('/api/notifications/push-subscribe', subscription),
  pushUnsubscribe: (endpoint) => del('/api/notifications/push-subscribe', { endpoint }),
  report: (data) => post('/api/reports', data),
  myReports: () => get('/api/reports/mine'),
  callConfig: () => get('/api/calls/config'),
  callHistory: () => get('/api/calls/history'),
  notices: () => get('/api/notices'),
  dismissNotice: (id) => post(`/api/notices/${id}/dismiss`),
  verifyEmail: (token) => post('/api/auth/email/verify', { token }),
  resendVerification: () => post('/api/auth/email/resend'),
  resendVerificationLink: (email) => post('/api/auth/email/resend-link', { email }),
  requestPhone: (phone) => patch('/api/users/me/phone', { phone }),
  verifyPhone: (code) => post('/api/users/me/phone/verify', { code }),
  removePhone: (password) => del('/api/users/me/phone', { password }),
  adminStats: () => get('/api/admin/stats'),
  adminUsers: (params = '') => get(`/api/admin/users${params}`),
  adminUser: (id, data) => patch(`/api/admin/users/${id}`, data),
  adminUserDetail: (id) => get(`/api/admin/users/${id}`),
  adminDeleteUser: (id) => del(`/api/admin/users/${id}`),
  adminResetPassword: (id) => post(`/api/admin/users/${id}/reset-password`),
  adminNotices: (params = '') => get(`/api/admin/notices${params}`),
  adminCreateNotice: (data) => post('/api/admin/notices', data),
  adminUpdateNotice: (id, data) => patch(`/api/admin/notices/${id}`, data),
  adminPublishNotice: (id, sendEmail = false) => post(`/api/admin/notices/${id}/publish`, { sendEmail }),
  adminArchiveNotice: (id) => post(`/api/admin/notices/${id}/archive`),
  adminDeleteNotice: (id) => del(`/api/admin/notices/${id}`),
  adminMail: (params = '') => get(`/api/admin/mail${params}`),
  adminTestMail: (to) => post('/api/admin/mail/test', { to }),
  adminProcessMail: () => post('/api/admin/mail/process'),
  adminRetryMail: (id) => post(`/api/admin/mail/${id}/retry`),
  adminCancelMail: (id) => del(`/api/admin/mail/${id}`),
  adminSettings: () => get('/api/admin/settings'),
  adminUpdateSettings: (data) => patch('/api/admin/settings', data),
  adminSystem: () => get('/api/admin/system'),
  adminFlushCache: () => post('/api/admin/system/cache/flush'),
  adminCleanup: () => post('/api/admin/system/cleanup'),
  forceLogout: (id) => post(`/api/admin/users/${id}/force-logout`),
  adminReports: (status = 'open', page = 1, limit = 25) =>
    get(`/api/admin/reports?status=${status}&page=${page}&limit=${limit}`),
  adminReport: (id) => get(`/api/admin/reports/${id}`),
  adminEvidence: (id) => get(`/api/admin/reports/${id}/evidence`),
  adminReview: (id, status, resolutionNote) =>
    patch(`/api/admin/reports/${id}`, { status, resolutionNote }),
  adminAudit: (params = '?limit=50') => get(`/api/admin/audit-logs${params}`),
  adminHealth: () => get('/api/admin/health'),
  adminStorage: () => get('/api/admin/storage')
};

/**
 * Bounded app-level semantic attributes for spans and logs
 */
export const AppAttributes = {
  OPERATION: 'app.operation',
  ENTITY_TYPE: 'app.entity_type',
  ENTITY_ID: 'app.entity_id',
  FEATURE: 'app.feature',
} as const;

/**
 * Auth-specific semantic attributes
 */
export const AuthAttributes = {
  ACTION: 'auth.action',
  STATUS: 'auth.status',
  METHOD: 'auth.method',
  USER_ROLE: 'user.effective_role',
  ACTOR_ID: 'auth.actor_id',
  TARGET_USER_ID: 'auth.target_user_id',
} as const;

/**
 * HTTP semantic attributes (standard OTel + custom)
 */
export const HttpAttributes = {
  ROUTE_TEMPLATE: 'http.route',
  CLIENT_IP: 'client.address',
} as const;

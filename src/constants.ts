/**
 * History sort order constants
 */
export const HistorySortOrder = {
    CREATED_AT: 'createdAt',
    COUNT: 'count',
    LAST_USED_AT: 'lastUsedAt',
} as const;

export type HistorySortOrderType = typeof HistorySortOrder[keyof typeof HistorySortOrder];

export { to_ts_identifier }

/**
Escapes identifier into a valid TS identifier.

@example
```typescript
to_ts_identifier('entry-id') === 'entry_id'
```
 */
function to_ts_identifier(s: string): string {
  return s.split(/-/).join('_')
}

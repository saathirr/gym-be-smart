import { useEffect, useState } from 'react';
import { storageService } from '../services/storageService';

// Signs a set of member photo paths in one request.
//
// The members list shows up to 200 rows and re-renders on every keystroke in the
// search box, so resolving a signed URL per row would mean hundreds of storage
// requests per search. This batches them and caches by path set, so filtering
// the list only re-signs when the set of visible photos actually changes.
//
// A signed URL is short-lived by design, so this is a cache with a short
// lifetime, not a permanent store. Anything older than the signature is simply
// re-fetched.

const REFRESH_MS = 4 * 60 * 1000;

export function useMemberPhotoUrls(paths) {
  const [urls, setUrls] = useState({});
  const [key, setKey] = useState('');

  // Paths are compared by value so a new array with the same contents, which is
  // what every re-render produces, does not trigger a refetch.
  const pathsKey = (paths || []).filter(Boolean).join('|');

  useEffect(() => {
    const list = pathsKey ? pathsKey.split('|') : [];
    let cancelled = false;

    async function resolve() {
      if (list.length === 0) {
        setUrls({});
        setKey('');
        return;
      }

      const signed = await storageService.getPhotoUrls(list);
      if (cancelled) return;

      setUrls(signed);
      setKey(pathsKey);
    }

    resolve();

    const timer = setInterval(resolve, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathsKey]);

  return { urls, isResolving: Boolean(pathsKey) && key !== pathsKey };
}

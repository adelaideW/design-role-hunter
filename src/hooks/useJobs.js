import { useEffect, useMemo, useState } from "react";
import fallbackJobs from "../data/jobs.json";
import jobSources from "../../scripts/job-sources.json";
import {
  fetchLiveJobs,
  formatPosted,
  getAreas,
  getCompanies,
  mergeJobs,
  sortJobs,
} from "../lib/jobs.js";

export function useJobs() {
  const [jobs, setJobs] = useState(() => sortJobs(fallbackJobs));
  const [loading, setLoading] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const live = await fetchLiveJobs(jobSources);
        if (cancelled) return;
        setJobs(mergeJobs(fallbackJobs, live));
        setLastSyncedAt(new Date());
      } catch (err) {
        if (!cancelled) setError(err?.message || "Could not refresh listings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const areas = useMemo(() => getAreas(jobs), [jobs]);
  const companies = useMemo(() => getCompanies(jobs), [jobs]);

  return {
    jobs,
    loading,
    lastSyncedAt,
    error,
    areas,
    companies,
    formatPosted,
  };
}

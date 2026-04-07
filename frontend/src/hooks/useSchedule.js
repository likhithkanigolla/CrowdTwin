import { useEffect } from 'react';
import { fetchSchedule } from '../api';
import { setSchedules } from '../engine/CrowdSimulator';

export function useSchedule() {
  useEffect(() => {
    const loadSchedule = async () => {
      try {
        const data = await fetchSchedule();
        
        if (data.schedule_by_time && Object.keys(data.schedule_by_time).length > 0) {
          // Convert backend schedule format to CrowdSimulator format
          const cohortSchedules = {};
          const scheduleByTime = data.schedule_by_time;
          
          // Initialize default schedules for all cohorts
          const cohortIds = ['ug1', 'ug2', 'ug3', 'ug4', 'faculty', 'staff'];
          cohortIds.forEach(id => {
            cohortSchedules[id] = {};
          });
          
          // Populate with backend data
          Object.entries(scheduleByTime).forEach(([timeStr, cohortData]) => {
            Object.entries(cohortData).forEach(([cohort, info]) => {
              const hour = parseInt(timeStr.split(':')[0], 10);
              if (!cohortSchedules[cohort]) cohortSchedules[cohort] = {};
              // Map venue to category based on venue name
              const category = inferCategory(info.venue);
              cohortSchedules[cohort][hour] = category;
            });
          });
          
          // Set the schedules in CrowdSimulator
          setSchedules(cohortSchedules, scheduleByTime);
          console.log('Schedule loaded from backend:', cohortSchedules);
        }
      } catch (error) {
        console.log('No custom schedule available, using defaults:', error.message);
        // Continue with default schedule
        setSchedules(null, {});
      }
    };
    
    loadSchedule();
  }, []);
}

function inferCategory(venueName) {
  const name = (venueName || '').toLowerCase();
  if (name.includes('academic') || name.includes('lab') || name.includes('lecture')) return 'academic';
  if (name.includes('canteen') || name.includes('dining') || name.includes('mess')) return 'canteen';
  if (name.includes('hostel') || name.includes('residence') || name.includes('bhavan')) return 'hostel';
  if (name.includes('sports') || name.includes('recreation') || name.includes('ground')) return 'recreation';
  if (name.includes('admin') || name.includes('office') || name.includes('registrar')) return 'admin';
  if (name.includes('gate') || name.includes('entrance')) return 'gate';
  return 'academic'; // default
}

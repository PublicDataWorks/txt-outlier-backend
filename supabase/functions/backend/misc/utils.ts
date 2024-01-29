export const intervalToString = (interval: string) => {
  const [hours, minutes, seconds] = interval.split(":").map(Number);

  if (hours > 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  } else if (minutes > 0) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  } else if (seconds > 0) {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  } else {
    return "Invalid interval format";
  }
};

export default {
  intervalToString,
} as const;

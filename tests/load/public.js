import http from "k6/http";
import { check } from "k6";
export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "10m",
      preAllocatedVUs: 40,
      maxVUs: 200,
    },
    spike: {
      executor: "constant-arrival-rate",
      startTime: "10m",
      rate: 200,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};
export default function publicLoad() {
  const response = http.get(`${__ENV.BASE_URL}/leaderboard`);
  check(response, { "public page is available": (r) => r.status === 200 });
}

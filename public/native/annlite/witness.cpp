#include "annlite/hnsw.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

namespace {

class DeterministicRng {
 public:
  explicit DeterministicRng(uint64_t seed) : state_(seed) {}

  double uniform() {
    state_ ^= state_ >> 12;
    state_ ^= state_ << 25;
    state_ ^= state_ >> 27;
    const uint64_t value = state_ * 2685821657736338717ULL;
    return (value >> 11) * (1.0 / 9007199254740992.0);
  }

  float normal() {
    const double u1 = std::max(uniform(), 1e-12);
    const double u2 = uniform();
    return static_cast<float>(std::sqrt(-2.0 * std::log(u1)) *
                              std::cos(6.283185307179586 * u2));
  }

 private:
  uint64_t state_;
};

struct FrontierPoint {
  size_t ef;
  double recall;
  double mean_computations;
};

std::string number(double value, int precision) {
  char buffer[64];
  std::snprintf(buffer, sizeof(buffer), "%.*f", precision, value);
  return buffer;
}

}  // namespace

extern "C" const char* annlite_witness_run() {
  constexpr size_t kDim = 24;
  constexpr size_t kVectors = 1800;
  constexpr size_t kQueries = 80;
  constexpr size_t kNeighbours = 10;
  constexpr size_t kClusters = 12;
  constexpr size_t kEfValues[] = {10, 20, 50, 100};

  annlite::HnswParams params;
  params.M = 8;
  params.ef_construction = 80;
  params.max_elements = kVectors;
  params.seed = 100;
  params.metric = annlite::Metric::L2;
  annlite::HnswIndex index(kDim, params);

  DeterministicRng rng(0xA11CE5EEDULL);
  std::vector<float> centers(kClusters * kDim);
  for (float& value : centers) value = 7.0f * rng.normal();

  std::vector<float> vector(kDim);
  for (size_t i = 0; i < kVectors; ++i) {
    const size_t cluster = i % kClusters;
    for (size_t d = 0; d < kDim; ++d) {
      vector[d] = centers[cluster * kDim + d] + 1.35f * rng.normal();
    }
    index.add(vector.data(), static_cast<annlite::label_t>(i));
  }

  std::vector<std::vector<float>> queries(kQueries, std::vector<float>(kDim));
  for (size_t q = 0; q < kQueries; ++q) {
    const size_t cluster = (q * 7) % kClusters;
    for (size_t d = 0; d < kDim; ++d) {
      queries[q][d] = centers[cluster * kDim + d] + 1.65f * rng.normal();
    }
  }

  std::vector<std::vector<annlite::label_t>> truth(kQueries);
  for (size_t q = 0; q < kQueries; ++q) {
    truth[q] = index.brute_force(queries[q].data(), kNeighbours).labels;
  }

  std::vector<FrontierPoint> frontier;
  for (const size_t ef : kEfValues) {
    size_t matches = 0;
    size_t computations = 0;
    for (size_t q = 0; q < kQueries; ++q) {
      const auto approximate = index.search(queries[q].data(), kNeighbours, ef);
      const std::unordered_set<annlite::label_t> expected(truth[q].begin(), truth[q].end());
      for (const auto label : approximate.labels) matches += expected.count(label);
      computations += approximate.distance_computations;
    }
    frontier.push_back({ef,
                        static_cast<double>(matches) / (kQueries * kNeighbours),
                        static_cast<double>(computations) / kQueries});
  }

  bool recall_monotone = true;
  bool work_monotone = true;
  for (size_t i = 1; i < frontier.size(); ++i) {
    recall_monotone = recall_monotone && frontier[i].recall + 1e-12 >= frontier[i - 1].recall;
    work_monotone = work_monotone && frontier[i].mean_computations >= frontier[i - 1].mean_computations;
  }
  const bool recovered = frontier.back().recall > frontier.front().recall &&
                         frontier.back().recall >= 0.95;
  const bool passed = recall_monotone && work_monotone && recovered;

  std::ostringstream json;
  json << "{\"engine\":\"annlite-cpp17-wasm\",\"passed\":" << (passed ? "true" : "false")
       << ",\"vectors\":" << kVectors << ",\"dimensions\":" << kDim
       << ",\"queries\":" << kQueries << ",\"k\":" << kNeighbours
       << ",\"recallMonotone\":" << (recall_monotone ? "true" : "false")
       << ",\"workMonotone\":" << (work_monotone ? "true" : "false")
       << ",\"frontier\":[";
  for (size_t i = 0; i < frontier.size(); ++i) {
    if (i) json << ',';
    json << "{\"ef\":" << frontier[i].ef << ",\"recall\":"
         << number(frontier[i].recall, 6) << ",\"meanComputations\":"
         << number(frontier[i].mean_computations, 2) << '}';
  }
  json << "]}";

  static std::string result;
  result = json.str();
  return result.c_str();
}

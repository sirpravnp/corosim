// Minimal step-wise wrapper around svZeroDSolver's Model + Integrator.
// Re-implements Solver's constructor/setup_initial (whose members are private)
// and exposes: load JSON, run N steps, record chosen DOFs, update block params,
// change cardiac period / time step between beats. Builds natively and to WASM.
#include <cmath>
#include <memory>
#include <string>
#include <vector>

#include "Integrator.h"
#include "Model.h"
#include "SimulationParameters.h"
#include "State.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
#include <emscripten/val.h>
#endif

class Sim {
 public:
  explicit Sim(const std::string& json_text) {
    auto config = nlohmann::json::parse(json_text);
    validate_input(config);
    sp_ = load_simulation_params(config);
    model_ = std::make_shared<Model>();
    load_simulation_model(config, *model_);
    if (sp_.sim_cardiac_period < 0 && model_->cardiac_cycle_period < 0)
      model_->cardiac_cycle_period = 1;
    else if (model_->cardiac_cycle_period < 0)
      model_->cardiac_cycle_period = sp_.sim_cardiac_period;
    state_ = load_initial_condition(config, *model_);
    pts_ = sp_.sim_pts_per_cycle;
    dt_ = model_->cardiac_cycle_period / (double(pts_) - 1.0);
    if (sp_.sim_steady_initial && !model_->has_block("CLH")) {
      double dts = model_->cardiac_cycle_period / 10.0;
      model_->to_steady();
      Integrator is(model_.get(), dts, sp_.sim_rho_infty, sp_.sim_abs_tol,
                    sp_.sim_nliter);
      for (int i = 0; i < 31; i++) state_ = is.step(state_, dts * double(i));
      model_->to_unsteady();
    }
    model_->setup_initial_state_dependent_parameters(state_);
    integ_ = Integrator(model_.get(), dt_, sp_.sim_rho_infty, sp_.sim_abs_tol,
                        sp_.sim_nliter, sp_.sim_max_iter_error_to_warning);
  }

  // --- configuration -------------------------------------------------------
  int ptsPerCycle() const { return pts_; }
  double period() const { return model_->cardiac_cycle_period; }
  double dt() const { return dt_; }
  double time() const { return time_; }
  int stateSize() const { return (int)state_.y.size(); }

  // Variable-period hook: new period + step size, keep state. Callers should
  // also rewrite any time-series parameters of the new length (see report).
  void setPeriod(double T, int pts) {
    model_->cardiac_cycle_period = T;
    pts_ = pts;
    dt_ = T / (double(pts) - 1.0);
    integ_.update_params(dt_);
  }
  void setTime(double t) { time_ = t; model_->time = t; }

  void setOutputs(const std::vector<std::string>& names) {
    idx_.clear();
    for (auto& n : names) idx_.push_back(model_->dofhandler.get_variable_index(n));
  }

  // --- stepping ------------------------------------------------------------
  // Advance n steps; if outputs registered, append one row per step.
  void step(int n) {
    for (int i = 0; i < n; i++) {
      state_ = integ_.step(state_, time_);
      time_ += dt_;
      if (!idx_.empty()) {
        for (int j : idx_) buf_.push_back(state_.y[j]);
        times_.push_back(time_);
      }
    }
  }
  // Advance one cycle (pts-1 steps).
  void runCycle() { step(pts_ - 1); }

  void clearBuffer() { buf_.clear(); times_.clear(); }
  size_t bufferRows() const { return times_.size(); }
  const std::vector<double>& buffer() const { return buf_; }
  const std::vector<double>& timesBuf() const { return times_; }

  double getY(const std::string& name) const {
    return state_.y[model_->dofhandler.get_variable_index(name)];
  }

  void updateBlockParams(const std::string& block, const std::vector<double>& p) {
    auto b = model_->get_block(block);
    if (p.size() != b->global_param_ids.size())
      throw std::runtime_error("param count mismatch for " + block);
    for (size_t i = 0; i < p.size(); i++) {
      model_->get_parameter(b->global_param_ids[i])->update(p[i]);
      model_->update_parameter_value(b->global_param_ids[i], p[i]);
    }
  }
  std::vector<double> readBlockParams(const std::string& block) {
    auto b = model_->get_block(block);
    std::vector<double> p(b->global_param_ids.size());
    for (size_t i = 0; i < p.size(); i++)
      p[i] = model_->get_parameter_value(b->global_param_ids[i]);
    return p;
  }
  // Replace a block's time-series parameter #k (e.g. Pim) with new times/values.
  void updateBlockTimeSeries(const std::string& block, int k,
                             const std::vector<double>& t,
                             const std::vector<double>& v) {
    auto b = model_->get_block(block);
    model_->get_parameter(b->global_param_ids[k])->update(t, v);
  }

 private:
  SimulationParameters sp_;
  std::shared_ptr<Model> model_;
  State state_;
  Integrator integ_;
  int pts_ = 0;
  double dt_ = 0, time_ = 0;
  std::vector<int> idx_;
  std::vector<double> buf_, times_;
};

#ifdef __EMSCRIPTEN__
using namespace emscripten;
EMSCRIPTEN_BINDINGS(svzerod) {
  register_vector<double>("VectorDouble");
  register_vector<std::string>("VectorString");
  class_<Sim>("Sim")
      .constructor<std::string>()
      .function("ptsPerCycle", &Sim::ptsPerCycle)
      .function("period", &Sim::period)
      .function("dt", &Sim::dt)
      .function("time", &Sim::time)
      .function("stateSize", &Sim::stateSize)
      .function("setPeriod", &Sim::setPeriod)
      .function("setTime", &Sim::setTime)
      .function("setOutputs", &Sim::setOutputs)
      .function("step", &Sim::step)
      .function("runCycle", &Sim::runCycle)
      .function("clearBuffer", &Sim::clearBuffer)
      .function("bufferRows", &Sim::bufferRows)
      .function("getY", &Sim::getY)
      .function("updateBlockParams", &Sim::updateBlockParams)
      .function("readBlockParams", &Sim::readBlockParams)
      .function("updateBlockTimeSeries", &Sim::updateBlockTimeSeries)
      // zero-copy views into WASM memory; valid until the next step()/clear
      .function("bufferView", optional_override([](Sim& s) {
        return val(typed_memory_view(s.buffer().size(), s.buffer().data()));
      }))
      .function("timesView", optional_override([](Sim& s) {
        return val(typed_memory_view(s.timesBuf().size(), s.timesBuf().data()));
      }));
}
#else
#include <chrono>
#include <fstream>
#include <iostream>
#include <sstream>
int main(int argc, char** argv) {  // native: shim <model.json> <ncycles>
  std::ifstream f(argv[1]); std::stringstream ss; ss << f.rdbuf();
  Sim s(ss.str());
  int nc = argc > 2 ? atoi(argv[2]) : 10;
  auto t0 = std::chrono::steady_clock::now();
  for (int i = 0; i < nc; i++) s.runCycle();
  double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  std::cout << nc << " cycles, " << ms / nc << " ms/cycle\n";
}
#endif

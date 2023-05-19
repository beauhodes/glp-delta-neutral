import { rebalance } from "./logic";
import { currentShortSizeEth, maxExpectedGlpOwnedUsd, overrideGlpOwned } from "./params";

rebalance(maxExpectedGlpOwnedUsd, currentShortSizeEth, overrideGlpOwned);

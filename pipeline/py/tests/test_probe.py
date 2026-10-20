import numpy as np

from flowwater.probe import truth_metrics


def test_truth_metrics_counts_iou_and_arms():
    water = np.zeros((4, 6), bool)
    water[1:3, 0:4] = True  # 8 px
    tw = np.zeros_like(water)
    tw[1:3, 1:5] = True  # 8 px: 6 on water (TP), 2 off water (FN)
    tl = np.zeros_like(water)
    tl[0:2, 0:1] = True  # 2 px of land: 1 on water (FP)
    hit = (np.array([1, 1, 2, 2]), np.array([0, 1, 2, 3]))  # all on water
    miss = (np.array([3, 3, 3, 3]), np.array([0, 1, 2, 3]))  # none on water
    m = truth_metrics(water, tw, tl, [hit, miss], res_m=10.0)
    assert (m["tpPx"], m["fpPx"], m["fnPx"]) == (6, 1, 2)
    assert m["iou"] == round(6 / 9, 4)
    assert (m["fpKm2"], m["fnKm2"]) == (0.0001, 0.0002)
    assert (m["armsTotal"], m["armsMissed"]) == (2, 1)
    assert [a["fraction"] for a in m["arms"]] == [1.0, 0.0]
    assert truth_metrics(water, ~water & False, ~water & False, [], 10.0)["iou"] is None

import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js/lib/core";
import box from "plotly.js/lib/box";
import histogram from "plotly.js/lib/histogram";
import scatter from "plotly.js/lib/scatter";

Plotly.register([scatter, box, histogram]);

export default createPlotlyComponent(Plotly);

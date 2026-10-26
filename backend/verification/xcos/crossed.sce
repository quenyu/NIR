// Перекрёстные обратные связи (пример 3.2 записки КП) в Xcos.
exec("xcos_lib.sci", -1); loadXcosLibs(); loadScicos();
scs_m = scicos_diagram();
[scs_m, r]  = add_block(scs_m, "CONST_m", "1", 0, 100, "r = 1");
[scs_m, s1] = add_block(scs_m, "SUMMATION", ["1"; "[-1;1;-1]"; "0"], 100, 100, "Σ1");
[scs_m, g1] = add_block(scs_m, "CLR", ["1"; "1+s"], 170, 100, "G1");
[scs_m, s2] = add_block(scs_m, "SUMMATION", ["1"; "[-1;1]"; "0"], 290, 100, "Σ2");
[scs_m, g2] = add_block(scs_m, "CLR", ["2"; "1+0.5*s"], 360, 100, "G2");
[scs_m, g3] = add_block(scs_m, "INTEGRAL_m", ["0"; "0"; "0"; "1"; "-1"], 490, 100, "G3");
[scs_m, h1] = add_block(scs_m, "GAINBLK", ["0.5"; "0"], 250, 200, "H1", %t);
[scs_m, h2] = add_block(scs_m, "GAINBLK", ["1"; "0"], 380, 45, "H2", %t);
[scs_m, sc, tw] = add_scope(scs_m, 680, 100, 0.01, 10, 0, 0.8);
scs_m = connect(scs_m, r, 1, s1, 2);
scs_m = connect(scs_m, s1, 1, g1, 1);
scs_m = connect(scs_m, g1, 1, s2, 2);
scs_m = connect(scs_m, s2, 1, g2, 1);
scs_m = fan(scs_m, g2, 1, [g3 1; h1 1], list(zeros(0, 2), [445 120; 445 220]));
scs_m = connect(scs_m, h1, 1, s1, 3, [90 220; 90 130]);
scs_m = fan(scs_m, g3, 1, [sc 1; tw 1; s1 1; h2 1], ..
    list(zeros(0, 2), [580 120; 580 250], [600 120; 600 20; 85 20; 85 110], [590 120; 590 65]));
scs_m = connect(scs_m, h2, 1, s2, 1, [275 65; 275 113.3]);
run_diagram(scs_m, "crossed", 10);

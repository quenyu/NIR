// Контур с ПИ-регулятором (пример 3.1 записки КП) в Xcos: PID из палитры Linear с Kд = 0.
exec("xcos_lib.sci", -1); loadXcosLibs(); loadScicos();
scs_m = scicos_diagram();
[scs_m, r]  = add_block(scs_m, "CONST_m", "1", 0, 100, "r = 1");
[scs_m, e]  = add_block(scs_m, "SUMMATION", ["1"; "[1;-1]"; "0"], 100, 100, "e");
[scs_m, c]  = add_block(scs_m, "PID", [], 180, 100, "ПИ: Kп = 2, Kи = 1");
scs_m.objs(c) = set_pid(scs_m.objs(c), 2, 1, 0);
[scs_m, g1] = add_block(scs_m, "CLR", ["1"; "1+s"], 300, 100, "звено 1");
[scs_m, g2] = add_block(scs_m, "CLR", ["1"; "1+0.5*s"], 420, 100, "звено 2");
[scs_m, sc, tw] = add_scope(scs_m, 600, 100, 0.01, 15, 0, 1.5);
scs_m = connect(scs_m, r, 1, e, 1);
scs_m = connect(scs_m, e, 1, c, 1);
scs_m = connect(scs_m, c, 1, g1, 1);
scs_m = connect(scs_m, g1, 1, g2, 1);
scs_m = fan(scs_m, g2, 1, [sc 1; tw 1; e 2], ..
    list(zeros(0, 2), [560 120; 560 250], [515 120; 515 200; 85 200; 85 126.7]));
run_diagram(scs_m, "pi", 15);

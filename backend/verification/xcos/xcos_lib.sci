// Сборка схемы Xcos из блоков палитры (без окон), запуск моделирования и выгрузка осциллографа в CSV.
// Каждый пример (pi.sce, crossed.sce, egsp.sce) собирает свою схему этими функциями.

// Координаты — как на холсте Xcos: x вправо, y вниз (orig — левый верхний угол блока).
// back = %t — блок обратной связи: сигнал идёт справа налево (вход справа, выход слева).
function [scs_m, n] = add_block(scs_m, gui, exprs, x, y, label, back)
    execstr("blk = " + gui + "(""define"");");
    if exprs <> [] then
        blk.graphics.exprs = exprs;
        // параметры применяются сразу, как после окна настройки блока: число портов уже верное
        tmp = scicos_diagram(); tmp.objs(1) = blk;
        %scicos_context = struct(); needcompile = 4; %cpr = list();
        [tmp, %cpr, needcompile, ok] = do_eval(tmp);
        blk = tmp.objs(1);
    end
    if gui == "SPLIT_f" | gui == "CLKSPLIT_f" then
        sz = [7, 7];
    elseif gui == "SUMMATION" then
        sz = [30, 40];
    else
        sz = [60, 40];
    end
    blk.graphics.sz = sz;
    blk.graphics.orig = [x, y];
    style = gui;
    if argn(2) > 6 then
        if back then style = style + ";mirror=true"; end
    end
    if label <> "" then
        blk.graphics.id = label;    // подпись под блоком
        style = style + ";verticalLabelPosition=bottom;verticalAlign=top;spacing=2";
    end
    if style <> gui then blk.graphics.style = style; end
    n = length(scs_m.objs) + 1;
    scs_m.objs(n) = blk;
endfunction

// Регулятор PID из палитры Linear: коэффициенты задаются внутри суперблока (P, I, D).
function blk = set_pid(blk, p, i, d)
    inner = blk.model.rpar;
    for k = 1:length(inner.objs)
        o = inner.objs(k);
        if typeof(o) <> "Link" then continue; end
        a = inner.objs(o.from(1)); b = inner.objs(o.to(1));
        if a.gui == "GAINBLK" then
            g = o.from(1); other = b.gui;
        elseif b.gui == "GAINBLK" then
            g = o.to(1); other = a.gui;
        else
            continue;
        end
        select other
        case "SUMMATION" then value = p;
        case "INTEGRAL_m" then value = i;
        case "DERIV" then value = d;
        else continue;
        end
        gain = inner.objs(g);
        gain.graphics.exprs(1) = string(value);
        gain.model.rpar = value;
        inner.objs(g) = gain;
    end
    blk.model.rpar = inner;
endfunction

function b = is_back(blk)
    b = bool2s(strindex(string(blk.graphics.style), "mirror=true") <> []);
endfunction

// Точки портов; порты нумеруются сверху вниз.
function [x, y] = out_point(blk, port)
    n = size(blk.model.out, "*");
    x = blk.graphics.orig(1) + blk.graphics.sz(1) * (1 - is_back(blk));
    y = blk.graphics.orig(2) + blk.graphics.sz(2) * port / (n + 1);
endfunction

function [x, y] = in_point(blk, port)
    n = size(blk.model.in, "*");
    x = blk.graphics.orig(1) + blk.graphics.sz(1) * is_back(blk);
    y = blk.graphics.orig(2) + blk.graphics.sz(2) * port / (n + 1);
endfunction

// Сигнальная связь «выход f.fp → вход t.tp»; via — промежуточные точки линии [x1 y1; x2 y2; ...].
function scs_m = connect(scs_m, f, fp, t, tp, via)
    bf = scs_m.objs(f); bt = scs_m.objs(t);
    [xf, yf] = out_point(bf, fp); [xt, yt] = in_point(bt, tp);
    if argn(2) < 6 then via = zeros(0, 2); end
    lk = scicos_link(xx=[xf; via(:, 1); xt], yy=[yf; via(:, 2); yt], ct=[1, 1], from=[f, fp, 0], to=[t, tp, 1]);
    n = length(scs_m.objs) + 1;
    scs_m.objs(n) = lk;
    bf.graphics.pout(fp) = n; bt.graphics.pin(tp) = n;
    scs_m.objs(f) = bf; scs_m.objs(t) = bt;
endfunction

// Один выход на несколько входов: точка разветвления SPLIT_f, как при протягивании ветки в Xcos.
// targets — строки [блок, порт]; vias — list() промежуточных точек для каждой ветки.
function scs_m = fan(scs_m, f, fp, targets, vias)
    k = size(targets, 1);
    [x, y] = out_point(scs_m.objs(f), fp);
    [scs_m, s] = add_block(scs_m, "SPLIT_f", [], x + 12, y - 3.5, "");
    sp = scs_m.objs(s);
    sp.model.out = -ones(k, 1); sp.model.out2 = ones(k, 1); sp.model.outtyp = ones(k, 1);
    sp.graphics.pout = zeros(k, 1); sp.graphics.out_implicit = emptystr(k, 1) + "E";
    scs_m.objs(s) = sp;
    scs_m = connect(scs_m, f, fp, s, 1);
    for i = 1:k
        if argn(2) < 5 then
            scs_m = connect(scs_m, s, i, targets(i, 1), targets(i, 2));
        else
            scs_m = connect(scs_m, s, i, targets(i, 1), targets(i, 2), vias(i));
        end
    end
endfunction

function scs_m = event_link(scs_m, f, t)
    bf = scs_m.objs(f); bt = scs_m.objs(t);
    x0 = bf.graphics.orig(1) + bf.graphics.sz(1) / 2; y0 = bf.graphics.orig(2) + bf.graphics.sz(2);
    x1 = bt.graphics.orig(1) + bt.graphics.sz(1) / 2; y1 = bt.graphics.orig(2);
    lk = scicos_link(xx=[x0; x1], yy=[y0; y1], ct=[5, -1], from=[f, 1, 0], to=[t, 1, 1]);
    n = length(scs_m.objs) + 1;
    scs_m.objs(n) = lk;
    bf.graphics.peout(1) = n; bt.graphics.pein(1) = n;
    scs_m.objs(f) = bf; scs_m.objs(t) = bt;
endfunction

// Осциллограф CSCOPE (окно графика в Xcos) и запись того же сигнала в переменную yout (TOWS_c).
// Оба получают такты от своих часов SampleCLK с шагом dt.
function [scs_m, scope, tows] = add_scope(scs_m, x, y, dt, t_end, ymin, ymax)
    npts = round(t_end / dt) + 10;
    [scs_m, scope] = add_block(scs_m, "CSCOPE", ["1 3 5 7 9 11 13 15"; "-1"; "[]"; "[600;400]"; ..
        string(ymin); string(ymax); string(t_end); "20"; "0"; "Осциллограф"], x, y, "Осциллограф");
    [scs_m, clk1] = add_block(scs_m, "SampleCLK", [string(dt); "0"], x + 10, y - 80, "");
    scs_m = event_link(scs_m, clk1, scope);
    [scs_m, tows] = add_block(scs_m, "TOWS_c", [string(npts); "yout"; "0"], x, y + 130, "");
    [scs_m, clk2] = add_block(scs_m, "SampleCLK", [string(dt); "0"], x + 10, y + 65, "");
    scs_m = event_link(scs_m, clk2, tows);
endfunction

// Проверяет параметры всех блоков, сохраняет схему .zcos (если доступно), моделирует и пишет CSV (t, y).
function run_diagram(scs_m, name, t_end)
    scs_m.props.tf = t_end;
    scs_m.props.tol = [1e-12; 1e-10; 1e-10; 100001; 0; 0; 0];
    scs_m.props.title = name;
    %scicos_context = struct(); needcompile = 4; %cpr = list();
    [scs_m, %cpr, needcompile, ok] = do_eval(scs_m);
    if ~ok then error("do_eval: " + name); end
    try
        xcosDiagramToScilab(name + ".zcos", scs_m);
    catch
        mprintf("%s.zcos не сохранён (нужен Scilab с Java)\n", name);
    end
    Info = scicos_simulate(scs_m, list(), "nw");
    t = yout.time; y = yout.values;
    keep = find(t <= t_end + 1e-9);
    csvWrite([t(keep), y(keep)], "../../../docs/study/xcos_" + name + ".csv", ",", ".", "%.15g");
    mprintf("%s: %d точек, y(end) = %.10g\n", name, size(keep, "*"), y(keep($)));
endfunction

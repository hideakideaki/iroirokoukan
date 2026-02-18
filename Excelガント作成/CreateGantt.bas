Sub BuildNormalized()

    Dim wsIn As Worksheet, wsN As Worksheet
    Dim r As Long, outRow As Long

    Set wsIn = Worksheets("Input")
    Set wsN = Worksheets("Normalized")

    Dim colYear As Long, colMonth As Long, colKind As Long
    Dim colValue As Long, colName As Long, colProj As Long, colDest As Long, colCat As Long
    colYear = GetHeaderCol(wsIn, "年")
    colMonth = GetHeaderCol(wsIn, "月")
    colKind = GetHeaderCol(wsIn, "指定")
    colValue = GetHeaderCol(wsIn, "値")
    colName = GetHeaderCol(wsIn, "マイルストン")
    colProj = GetHeaderCol(wsIn, "Proj")
    colDest = GetHeaderCol(wsIn, "仕向け")
    colCat = GetHeaderCol(wsIn, "分類")
    If colYear = 0 Or colMonth = 0 Or colKind = 0 Or colValue = 0 Or colName = 0 Or colProj = 0 Or colDest = 0 Or colCat = 0 Then
        MsgBox "Inputシートのヘッダーが見つかりません。", vbExclamation
        Exit Sub
    End If

    wsN.Cells.Clear
    wsN.Range("A1:J1").Value = Array("Year", "Month", "TMB", "Text", "ColorType", "Name", "InputValue", "Proj", "Dest", "Category")

    outRow = 2

    For r = 2 To wsIn.Cells(wsIn.Rows.Count, 1).End(xlUp).Row

        Dim y As Long, m As Long
        Dim kind As String, val As String, name As String, proj As String, dest As String, cat As String

        y = wsIn.Cells(r, colYear).Value
        m = wsIn.Cells(r, colMonth).Value
        kind = wsIn.Cells(r, colKind).Value
        val = wsIn.Cells(r, colValue).Value
        name = wsIn.Cells(r, colName).Value
        proj = wsIn.Cells(r, colProj).Value
        dest = wsIn.Cells(r, colDest).Value
        cat = wsIn.Cells(r, colCat).Value

        Select Case kind

            Case "月"
                wsN.Cells(outRow, 1).Resize(1, 10).Value = _
                    Array(y, m, "", "★" & name, "MONTH", name, val, proj, dest, cat)
                outRow = outRow + 1

            Case "旬"
                wsN.Cells(outRow, 1).Resize(1, 10).Value = _
                    Array(y, m, val, "★" & name, "DATE", name, val, proj, dest, cat)
                outRow = outRow + 1

            Case "日"
                Dim tmb As String
                If val <= 10 Then
                    tmb = "T"
                ElseIf val <= 20 Then
                    tmb = "M"
                Else
                    tmb = "B"
                End If
                wsN.Cells(outRow, 1).Resize(1, 10).Value = _
                    Array(y, m, tmb, "★" & name, "DATE", name, val, proj, dest, cat)
                outRow = outRow + 1

        End Select
    Next r
End Sub


Sub DrawGantt()

    Dim COLOR_MONTH As Long
    Dim COLOR_DATE As Long
    Dim START_YEAR As Long
    Dim END_YEAR As Long
    Dim ganttColWidth As Double
    Dim catColors As Object

    COLOR_MONTH = RGB(255, 242, 204) ' 月指定（薄色）
    COLOR_DATE = RGB(198, 239, 206)  ' 日付・旬指定（濃色）
    EnsureSettingSheet
    START_YEAR = CLng(Worksheets("Setting").Range("B1").Value)
    END_YEAR = CLng(Worksheets("Setting").Range("B2").Value)
    ganttColWidth = 3

    Dim settingColWidth As Variant
    Dim settingMonthColor As Variant
    Dim settingDateColor As Variant
    settingColWidth = Worksheets("Setting").Range("B3").Value
    settingMonthColor = Worksheets("Setting").Range("B4").Value
    settingDateColor = Worksheets("Setting").Range("B5").Value
    If IsNumeric(settingColWidth) And settingColWidth > 0 Then
        ganttColWidth = CDbl(settingColWidth)
    End If
    COLOR_MONTH = ParseSettingColor(settingMonthColor, COLOR_MONTH)
    COLOR_DATE = ParseSettingColor(settingDateColor, COLOR_DATE)
    Set catColors = LoadCategoryColors(Worksheets("Setting"))

    Dim wsN As Worksheet, wsG As Worksheet
    Set wsN = Worksheets("Normalized")
    Set wsG = Worksheets("Gantt")

    wsG.Cells.Clear
    wsG.Cells(2, 1).Value = "Proj"
    wsG.Cells(2, 2).Value = "仕向け"
    wsG.Cells(2, 3).Value = "分類"
    wsG.Cells(2, 4).Value = "Milestone"
    wsG.Cells(2, 5).Value = "Date"

    ' 軸作成（例：2025年）
    Dim startCol As Long: startCol = 6
    Dim c As Long: c = startCol
    Dim y As Long, m As Long
    For y = START_YEAR To END_YEAR
        For m = 1 To 12
            wsG.Range(wsG.Cells(1, c), wsG.Cells(1, c + 2)).Merge
            wsG.Cells(1, c).Value = y & "/" & m
            wsG.Cells(1, c).HorizontalAlignment = xlCenter
            wsG.Cells(2, c).Value = "T"
            wsG.Cells(2, c + 1).Value = "M"
            wsG.Cells(2, c + 2).Value = "B"
            c = c + 3
        Next
    Next
    Dim lastCol As Long
    lastCol = c - 1
    wsG.Range(wsG.Cells(1, startCol), wsG.Cells(1, lastCol)).EntireColumn.ColumnWidth = ganttColWidth

    Dim r As Long
    Dim prevProj As String
    Dim prevDest As String
    Dim prevCat As String
    Dim ganttRow As Long
    ganttRow = 3
    For r = 2 To wsN.Cells(wsN.Rows.Count, 1).End(xlUp).Row

        Dim key As String
        key = wsN.Cells(r, 1) & "/" & wsN.Cells(r, 2) & "/" & wsN.Cells(r, 3)

        Dim curProj As String
        curProj = CStr(wsN.Cells(r, 8).Value)
        Dim curDest As String
        curDest = CStr(wsN.Cells(r, 9).Value)
        Dim curCat As String
        curCat = CStr(wsN.Cells(r, 10).Value)
        If Len(prevProj) > 0 And (curProj <> prevProj Or curDest <> prevDest Or curCat <> prevCat) Then
            ganttRow = ganttRow + 1
            With wsG.Range(wsG.Cells(ganttRow, 1), wsG.Cells(ganttRow, lastCol)).Borders(xlEdgeTop)
                .LineStyle = xlContinuous
                .Weight = xlThick
            End With
        End If
        wsG.Cells(ganttRow, 1).Value = curProj
        If Len(curProj) > 0 And curProj = prevProj Then
            wsG.Cells(ganttRow, 1).Font.Color = RGB(180, 180, 180)
        Else
            wsG.Cells(ganttRow, 1).Font.ColorIndex = xlAutomatic
        End If
        wsG.Cells(ganttRow, 2).Value = curDest
        If Len(curDest) > 0 And curDest = prevDest Then
            wsG.Cells(ganttRow, 2).Font.Color = RGB(180, 180, 180)
        Else
            wsG.Cells(ganttRow, 2).Font.ColorIndex = xlAutomatic
        End If
        wsG.Cells(ganttRow, 3).Value = curCat
        wsG.Cells(ganttRow, 4).Value = wsN.Cells(r, 6)
        If Len(Trim(CStr(wsN.Cells(r, 7).Value))) = 0 Then
            wsG.Cells(ganttRow, 5).Value = wsN.Cells(r, 1) & "/" & wsN.Cells(r, 2)
        Else
            wsG.Cells(ganttRow, 5).Value = wsN.Cells(r, 1) & "/" & wsN.Cells(r, 2) & "/" & wsN.Cells(r, 7)
        End If
        prevProj = curProj
        prevDest = curDest
        prevCat = curCat

        Dim catColor As Variant
        catColor = GetCategoryColor(catColors, CStr(wsN.Cells(r, 10).Value))
        If wsN.Cells(r, 5).Value = "MONTH" Then
            Dim monthKey As String
            monthKey = wsN.Cells(r, 1) & "/" & wsN.Cells(r, 2)
            For c = startCol To lastCol Step 3
                If wsG.Cells(1, c).Value = monthKey Then
                    Dim fillColor As Long
                    If Not IsEmpty(catColor) Then
                        fillColor = CLng(catColor)
                    Else
                        fillColor = COLOR_MONTH
                    End If
                    With wsG.Cells(ganttRow, c)
                        .Interior.Color = fillColor
                        .Value = wsN.Cells(r, 4)
                        .WrapText = False
                        .HorizontalAlignment = xlLeft
                    End With
                    wsG.Cells(ganttRow, c + 1).Interior.Color = fillColor
                    wsG.Cells(ganttRow, c + 2).Interior.Color = fillColor
                End If
            Next
        Else
            For c = startCol To wsG.Cells(2, wsG.Columns.Count).End(xlToLeft).Column
                Dim headerCol As Long
                headerCol = c - ((c - startCol) Mod 3)
                If wsG.Cells(1, headerCol).Value & "/" & wsG.Cells(2, c).Value = key Then
                    Dim fillColorDate As Long
                    If Not IsEmpty(catColor) Then
                        fillColorDate = CLng(catColor)
                    Else
                        fillColorDate = COLOR_DATE
                    End If
                    With wsG.Cells(ganttRow, c)
                        .Interior.Color = fillColorDate
                        .Value = wsN.Cells(r, 4)
                        .WrapText = False
                        .HorizontalAlignment = xlLeft
                    End With
                End If
            Next
        End If
        ganttRow = ganttRow + 1
    Next

    Dim lastDataRow As Long
    lastDataRow = ganttRow - 1
    If lastDataRow >= 2 Then
        wsG.Range(wsG.Cells(2, 1), wsG.Cells(lastDataRow, startCol - 1)).AutoFilter
    End If

    BuildMilestoneProjTable
End Sub

Sub RunAll()
    BuildNormalized
    DrawGantt
    DrawGanttYearMonth
    DrawGanttCompressed
    BuildMilestoneProjTable
End Sub

Sub DrawGanttYearMonth()
    Dim COLOR_MONTH As Long
    Dim COLOR_DATE As Long
    Dim START_YEAR As Long
    Dim END_YEAR As Long
    Dim ganttColWidth As Double
    Dim catColors As Object
    Dim showTMB As Boolean

    COLOR_MONTH = RGB(255, 242, 204)
    COLOR_DATE = RGB(198, 239, 206)
    EnsureSettingSheet
    START_YEAR = CLng(Worksheets("Setting").Range("B1").Value)
    END_YEAR = CLng(Worksheets("Setting").Range("B2").Value)
    ganttColWidth = 3

    Dim settingColWidth As Variant
    Dim settingMonthColor As Variant
    Dim settingDateColor As Variant
    settingColWidth = Worksheets("Setting").Range("B3").Value
    settingMonthColor = Worksheets("Setting").Range("B4").Value
    settingDateColor = Worksheets("Setting").Range("B5").Value
    If IsNumeric(settingColWidth) And settingColWidth > 0 Then
        ganttColWidth = CDbl(settingColWidth)
    End If
    COLOR_MONTH = ParseSettingColor(settingMonthColor, COLOR_MONTH)
    COLOR_DATE = ParseSettingColor(settingDateColor, COLOR_DATE)
    Set catColors = LoadCategoryColors(Worksheets("Setting"))
    showTMB = (CLng(Worksheets("Setting").Range("B6").Value) <> 0)

    Dim wsN As Worksheet, wsG As Worksheet
    Set wsN = Worksheets("Normalized")

    On Error Resume Next
    Set wsG = Worksheets("Gantt_YM")
    On Error GoTo 0
    If wsG Is Nothing Then
        Set wsG = Worksheets.Add(After:=Worksheets(Worksheets.Count))
        wsG.Name = "Gantt_YM"
    End If

    wsG.Cells.Clear
    wsG.Cells(2, 1).Value = "Proj"
    wsG.Cells(2, 2).Value = "仕向け"
    wsG.Cells(2, 3).Value = "分類"
    wsG.Cells(2, 4).Value = "Milestone"
    wsG.Cells(2, 5).Value = "Date"

    Dim startCol As Long: startCol = 6
    Dim c As Long: c = startCol
    Dim y As Long, m As Long
    For y = START_YEAR To END_YEAR
        Dim yearStartCol As Long
        yearStartCol = c
        For m = 1 To 12
            If showTMB Then
                wsG.Range(wsG.Cells(2, c), wsG.Cells(2, c + 2)).Merge
                wsG.Cells(2, c).Value = m
                wsG.Cells(2, c).HorizontalAlignment = xlCenter
                wsG.Cells(3, c).Value = "T"
                wsG.Cells(3, c + 1).Value = "M"
                wsG.Cells(3, c + 2).Value = "B"
                c = c + 3
            Else
                wsG.Cells(2, c).Value = m
                wsG.Cells(2, c).HorizontalAlignment = xlCenter
                c = c + 1
            End If
        Next
        wsG.Range(wsG.Cells(1, yearStartCol), wsG.Cells(1, c - 1)).Merge
        wsG.Cells(1, yearStartCol).Value = y
        wsG.Cells(1, yearStartCol).HorizontalAlignment = xlCenter
    Next
    Dim lastCol As Long
    lastCol = c - 1
    wsG.Range(wsG.Cells(1, startCol), wsG.Cells(1, lastCol)).EntireColumn.ColumnWidth = ganttColWidth

    Dim r As Long
    Dim prevProj As String
    Dim prevDest As String
    Dim prevCat As String
    Dim ganttRow As Long
    If showTMB Then
        ganttRow = 4
    Else
        ganttRow = 3
    End If
    For r = 2 To wsN.Cells(wsN.Rows.Count, 1).End(xlUp).Row
        Dim key As String
        key = wsN.Cells(r, 1) & "/" & wsN.Cells(r, 2) & "/" & wsN.Cells(r, 3)

        Dim curProj As String
        curProj = CStr(wsN.Cells(r, 8).Value)
        Dim curDest As String
        curDest = CStr(wsN.Cells(r, 9).Value)
        Dim curCat As String
        curCat = CStr(wsN.Cells(r, 10).Value)
        If Len(prevProj) > 0 And (curProj <> prevProj Or curDest <> prevDest Or curCat <> prevCat) Then
            ganttRow = ganttRow + 1
            With wsG.Range(wsG.Cells(ganttRow, 1), wsG.Cells(ganttRow, lastCol)).Borders(xlEdgeTop)
                .LineStyle = xlContinuous
                .Weight = xlThick
            End With
        End If
        wsG.Cells(ganttRow, 1).Value = curProj
        If Len(curProj) > 0 And curProj = prevProj Then
            wsG.Cells(ganttRow, 1).Font.Color = RGB(180, 180, 180)
        Else
            wsG.Cells(ganttRow, 1).Font.ColorIndex = xlAutomatic
        End If
        wsG.Cells(ganttRow, 2).Value = curDest
        If Len(curDest) > 0 And curDest = prevDest Then
            wsG.Cells(ganttRow, 2).Font.Color = RGB(180, 180, 180)
        Else
            wsG.Cells(ganttRow, 2).Font.ColorIndex = xlAutomatic
        End If
        wsG.Cells(ganttRow, 3).Value = curCat
        wsG.Cells(ganttRow, 4).Value = wsN.Cells(r, 6)
        If Len(Trim(CStr(wsN.Cells(r, 7).Value))) = 0 Then
            wsG.Cells(ganttRow, 5).Value = wsN.Cells(r, 1) & "/" & wsN.Cells(r, 2)
        Else
            wsG.Cells(ganttRow, 5).Value = wsN.Cells(r, 1) & "/" & wsN.Cells(r, 2) & "/" & wsN.Cells(r, 7)
        End If
        prevProj = curProj
        prevDest = curDest
        prevCat = curCat

        Dim catColor As Variant
        catColor = GetCategoryColor(catColors, CStr(wsN.Cells(r, 10).Value))
        If IsNumeric(wsN.Cells(r, 1).Value) And IsNumeric(wsN.Cells(r, 2).Value) Then
            Dim fillColor As Long
            If Not IsEmpty(catColor) Then
                fillColor = CLng(catColor)
            ElseIf wsN.Cells(r, 5).Value = "MONTH" Then
                fillColor = COLOR_MONTH
            Else
                fillColor = COLOR_DATE
            End If

            If showTMB Then
                Dim tmbOffset As Long
                Select Case CStr(wsN.Cells(r, 3).Value)
                    Case "T": tmbOffset = 0
                    Case "M": tmbOffset = 1
                    Case "B": tmbOffset = 2
                    Case Else: tmbOffset = 0
                End Select
                Dim targetColTmb As Long
                targetColTmb = startCol + (CLng(wsN.Cells(r, 1).Value) - START_YEAR) * 36 + (CLng(wsN.Cells(r, 2).Value) - 1) * 3 + tmbOffset
                If targetColTmb >= startCol And targetColTmb <= lastCol Then
                    With wsG.Cells(ganttRow, targetColTmb)
                        .Interior.Color = fillColor
                        .Value = wsN.Cells(r, 4)
                        .WrapText = False
                        .HorizontalAlignment = xlLeft
                    End With
                    If wsN.Cells(r, 5).Value = "MONTH" Then
                        wsG.Cells(ganttRow, targetColTmb + 1).Interior.Color = fillColor
                        wsG.Cells(ganttRow, targetColTmb + 2).Interior.Color = fillColor
                    End If
                End If
            Else
                Dim targetCol As Long
                targetCol = startCol + (CLng(wsN.Cells(r, 1).Value) - START_YEAR) * 12 + (CLng(wsN.Cells(r, 2).Value) - 1)
                If targetCol >= startCol And targetCol <= lastCol Then
                    With wsG.Cells(ganttRow, targetCol)
                        .Interior.Color = fillColor
                        .Value = wsN.Cells(r, 4)
                        .WrapText = False
                        .HorizontalAlignment = xlLeft
                    End With
                End If
            End If
        End If
        ganttRow = ganttRow + 1
    Next

    Dim lastDataRow As Long
    lastDataRow = ganttRow - 1
    If lastDataRow >= 2 Then
        wsG.Range(wsG.Cells(2, 1), wsG.Cells(lastDataRow, startCol - 1)).AutoFilter
    End If
End Sub

Sub BuildMilestoneProjTable()
    Dim wsIn As Worksheet, wsT As Worksheet
    Set wsIn = Worksheets("Input")

    On Error Resume Next
    Set wsT = Worksheets("MilestoneProj")
    On Error GoTo 0
    If wsT Is Nothing Then
        Set wsT = Worksheets.Add(After:=Worksheets(Worksheets.Count))
        wsT.Name = "MilestoneProj"
    End If

    wsT.Cells.Clear

    Dim milestones As Object, projs As Object
    Set milestones = CreateObject("Scripting.Dictionary")
    Set projs = CreateObject("Scripting.Dictionary")

    Dim colYear As Long, colMonth As Long, colValue As Long
    Dim colName As Long, colProj As Long
    colYear = GetHeaderCol(wsIn, "年")
    colMonth = GetHeaderCol(wsIn, "月")
    colValue = GetHeaderCol(wsIn, "値")
    colName = GetHeaderCol(wsIn, "マイルストン")
    colProj = GetHeaderCol(wsIn, "Proj")
    If colYear = 0 Or colMonth = 0 Or colValue = 0 Or colName = 0 Or colProj = 0 Then
        MsgBox "Inputシートのヘッダーが見つかりません。", vbExclamation
        Exit Sub
    End If

    Dim r As Long
    For r = 2 To wsIn.Cells(wsIn.Rows.Count, 1).End(xlUp).Row
        Dim name As String, proj As String
        name = CStr(wsIn.Cells(r, colName).Value)
        proj = CStr(wsIn.Cells(r, colProj).Value)
        If Len(name) > 0 Then milestones(name) = True
        If Len(proj) > 0 Then projs(proj) = True
    Next

    Dim i As Long
    wsT.Cells(1, 1).Value = "Milestone"
    i = 0
    Dim key As Variant
    For Each key In projs.Keys
        i = i + 1
        wsT.Cells(1, i + 1).Value = key
    Next

    i = 0
    For Each key In milestones.Keys
        i = i + 1
        wsT.Cells(i + 1, 1).Value = key
    Next

    Dim rowMap As Object, colMap As Object
    Set rowMap = CreateObject("Scripting.Dictionary")
    Set colMap = CreateObject("Scripting.Dictionary")

    For i = 2 To wsT.Cells(wsT.Rows.Count, 1).End(xlUp).Row
        rowMap(CStr(wsT.Cells(i, 1).Value)) = i
    Next
    For i = 2 To wsT.Cells(1, wsT.Columns.Count).End(xlToLeft).Column
        colMap(CStr(wsT.Cells(1, i).Value)) = i
    Next

    For r = 2 To wsIn.Cells(wsIn.Rows.Count, 1).End(xlUp).Row
        Dim y As Variant, m As Variant, val As Variant
        Dim rowIdx As Long, colIdx As Long
        name = CStr(wsIn.Cells(r, colName).Value)
        proj = CStr(wsIn.Cells(r, colProj).Value)
        If Len(name) = 0 Or Len(proj) = 0 Then GoTo NextRow

        If Not rowMap.Exists(name) Or Not colMap.Exists(proj) Then GoTo NextRow
        rowIdx = rowMap(name)
        colIdx = colMap(proj)

        y = wsIn.Cells(r, colYear).Value
        m = wsIn.Cells(r, colMonth).Value
        val = wsIn.Cells(r, colValue).Value
        If Len(Trim(CStr(val))) = 0 Then
            wsT.Cells(rowIdx, colIdx).Value = y & "/" & m
        Else
            wsT.Cells(rowIdx, colIdx).Value = y & "/" & m & "/" & val
        End If
NextRow:
    Next
End Sub

Private Function GetHeaderCol(ByVal ws As Worksheet, ByVal headerName As String) As Long
    Dim lastCol As Long
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    Dim c As Long
    For c = 1 To lastCol
        If CStr(ws.Cells(1, c).Value) = headerName Then
            GetHeaderCol = c
            Exit Function
        End If
    Next
    GetHeaderCol = 0
End Function

Private Sub EnsureSettingSheet()
    Dim wsS As Worksheet
    Set wsS = Worksheets("Setting")

    If Len(CStr(wsS.Range("A1").Value)) = 0 Then wsS.Range("A1").Value = "開始年"
    If Len(CStr(wsS.Range("A2").Value)) = 0 Then wsS.Range("A2").Value = "終了年"
    If Len(CStr(wsS.Range("A3").Value)) = 0 Then wsS.Range("A3").Value = "列幅"
    If Len(CStr(wsS.Range("A4").Value)) = 0 Then wsS.Range("A4").Value = "月色(RGB)"
    If Len(CStr(wsS.Range("A5").Value)) = 0 Then wsS.Range("A5").Value = "日付色(RGB)"
    If Len(CStr(wsS.Range("A6").Value)) = 0 Then wsS.Range("A6").Value = "Gantt_YM TMB(1=表示)"

    If Len(CStr(wsS.Range("B3").Value)) = 0 Then wsS.Range("B3").Value = 3
    If Len(CStr(wsS.Range("B4").Value)) = 0 Then wsS.Range("B4").Value = "255,242,204"
    If Len(CStr(wsS.Range("B5").Value)) = 0 Then wsS.Range("B5").Value = "198,239,206"
    If Len(CStr(wsS.Range("B6").Value)) = 0 Then wsS.Range("B6").Value = 0

    If Len(CStr(wsS.Range("A7").Value)) = 0 Then wsS.Range("A7").Value = "分類"
    If Len(CStr(wsS.Range("B7").Value)) = 0 Then wsS.Range("B7").Value = "色(RGB)"
    If Len(CStr(wsS.Range("A8").Value)) = 0 And Len(CStr(wsS.Range("B8").Value)) = 0 Then
        wsS.Range("A8").Value = "例:分類A"
        wsS.Range("B8").Value = "200,230,255"
    End If
End Sub

Private Function ParseSettingColor(ByVal settingValue As Variant, ByVal defaultColor As Long) As Long
    If IsNumeric(settingValue) Then
        ParseSettingColor = CLng(settingValue)
        Exit Function
    End If

    Dim textValue As String
    textValue = Replace(CStr(settingValue), " ", "")
    If InStr(textValue, ",") > 0 Then
        Dim parts() As String
        parts = Split(textValue, ",")
        If UBound(parts) = 2 Then
            Dim r As Long, g As Long, b As Long
            If IsNumeric(parts(0)) And IsNumeric(parts(1)) And IsNumeric(parts(2)) Then
                r = CLng(parts(0))
                g = CLng(parts(1))
                b = CLng(parts(2))
                If r >= 0 And r <= 255 And g >= 0 And g <= 255 And b >= 0 And b <= 255 Then
                    ParseSettingColor = RGB(r, g, b)
                    Exit Function
                End If
            End If
        End If
    End If

    ParseSettingColor = defaultColor
End Function

Private Function LoadCategoryColors(ByVal wsS As Worksheet) As Object
    Dim dict As Object
    Set dict = CreateObject("Scripting.Dictionary")

    Dim r As Long
    r = 8
    Do While Len(CStr(wsS.Cells(r, 1).Value)) > 0
        Dim cat As String
        cat = CStr(wsS.Cells(r, 1).Value)
        Dim colorValue As Variant
        colorValue = wsS.Cells(r, 2).Value
        Dim parsed As Long
        parsed = ParseSettingColor(colorValue, -1)
        If parsed <> -1 Then
            dict(cat) = parsed
        End If
        r = r + 1
    Loop

    Set LoadCategoryColors = dict
End Function

Private Function GetCategoryColor(ByVal dict As Object, ByVal category As String) As Variant
    If Len(category) = 0 Then
        GetCategoryColor = Empty
        Exit Function
    End If
    If dict.Exists(category) Then
        GetCategoryColor = dict(category)
    Else
        GetCategoryColor = Empty
    End If
End Function

Sub DrawGanttCompressed()
    Dim COLOR_MONTH As Long
    Dim COLOR_DATE As Long
    Dim START_YEAR As Long
    Dim END_YEAR As Long
    Dim ganttColWidth As Double
    Dim catColors As Object

    COLOR_MONTH = RGB(255, 242, 204)
    COLOR_DATE = RGB(198, 239, 206)
    EnsureSettingSheet
    START_YEAR = CLng(Worksheets("Setting").Range("B1").Value)
    END_YEAR = CLng(Worksheets("Setting").Range("B2").Value)
    ganttColWidth = 3

    Dim settingColWidth As Variant
    Dim settingMonthColor As Variant
    Dim settingDateColor As Variant
    settingColWidth = Worksheets("Setting").Range("B3").Value
    settingMonthColor = Worksheets("Setting").Range("B4").Value
    settingDateColor = Worksheets("Setting").Range("B5").Value
    If IsNumeric(settingColWidth) And settingColWidth > 0 Then
        ganttColWidth = CDbl(settingColWidth)
    End If
    COLOR_MONTH = ParseSettingColor(settingMonthColor, COLOR_MONTH)
    COLOR_DATE = ParseSettingColor(settingDateColor, COLOR_DATE)
    Set catColors = LoadCategoryColors(Worksheets("Setting"))

    Dim wsN As Worksheet, wsG As Worksheet
    Set wsN = Worksheets("Normalized")
    On Error Resume Next
    Set wsG = Worksheets("Gantt_Compact")
    On Error GoTo 0
    If wsG Is Nothing Then
        Set wsG = Worksheets.Add(After:=Worksheets(Worksheets.Count))
        wsG.Name = "Gantt_Compact"
    End If

    wsG.Cells.Clear
    wsG.Cells(2, 1).Value = "Proj"
    wsG.Cells(2, 2).Value = "Dest"
    wsG.Cells(2, 3).Value = "Category"
    wsG.Cells(2, 4).Value = "Milestone"
    wsG.Cells(2, 5).Value = "Date"

    Dim startCol As Long: startCol = 6
    Dim c As Long: c = startCol
    Dim y As Long, m As Long
    For y = START_YEAR To END_YEAR
        For m = 1 To 12
            wsG.Range(wsG.Cells(1, c), wsG.Cells(1, c + 2)).Merge
            wsG.Cells(1, c).Value = y & "/" & m
            wsG.Cells(1, c).HorizontalAlignment = xlCenter
            wsG.Cells(2, c).Value = "T"
            wsG.Cells(2, c + 1).Value = "M"
            wsG.Cells(2, c + 2).Value = "B"
            c = c + 3
        Next
    Next

    Dim lastCol As Long
    lastCol = c - 1
    wsG.Range(wsG.Cells(1, startCol), wsG.Cells(1, lastCol)).EntireColumn.ColumnWidth = ganttColWidth

    Dim lanes As Collection
    Dim laneEndCols As Object
    Set lanes = New Collection
    Set laneEndCols = CreateObject("Scripting.Dictionary")

    Dim currentRow As Long
    currentRow = 3

    Dim prevGroupKey As String
    prevGroupKey = ""

    Dim r As Long
    For r = 2 To wsN.Cells(wsN.Rows.Count, 1).End(xlUp).Row
        Dim yr As Long, mo As Long
        If Not IsNumeric(wsN.Cells(r, 1).Value) Or Not IsNumeric(wsN.Cells(r, 2).Value) Then GoTo NextR
        yr = CLng(wsN.Cells(r, 1).Value)
        mo = CLng(wsN.Cells(r, 2).Value)
        If yr < START_YEAR Or yr > END_YEAR Then GoTo NextR
        If mo < 1 Or mo > 12 Then GoTo NextR

        Dim curProj As String, curDest As String, curCat As String
        curProj = CStr(wsN.Cells(r, 8).Value)
        curDest = CStr(wsN.Cells(r, 9).Value)
        curCat = CStr(wsN.Cells(r, 10).Value)

        Dim groupKey As String
        groupKey = curProj & "|" & curDest & "|" & curCat

        If Len(prevGroupKey) > 0 And groupKey <> prevGroupKey Then
            currentRow = currentRow + 1
            With wsG.Range(wsG.Cells(currentRow, 1), wsG.Cells(currentRow, lastCol)).Borders(xlEdgeTop)
                .LineStyle = xlContinuous
                .Weight = xlThick
            End With
            Set lanes = New Collection
            Set laneEndCols = CreateObject("Scripting.Dictionary")
        End If
        prevGroupKey = groupKey

        Dim eventStartCol As Long, eventEndCol As Long
        Dim visualEndCol As Long
        Dim baseCol As Long
        baseCol = startCol + (yr - START_YEAR) * 36 + (mo - 1) * 3

        If wsN.Cells(r, 5).Value = "MONTH" Then
            eventStartCol = baseCol
            eventEndCol = baseCol + 2
        Else
            Dim tmb As String
            tmb = CStr(wsN.Cells(r, 3).Value)
            Select Case tmb
                Case "T": eventStartCol = baseCol
                Case "M": eventStartCol = baseCol + 1
                Case "B": eventStartCol = baseCol + 2
                Case Else: eventStartCol = baseCol
            End Select
            eventEndCol = eventStartCol
        End If
        visualEndCol = GetVisualEndCol(eventStartCol, eventEndCol, CStr(wsN.Cells(r, 4).Value), ganttColWidth)

        Dim laneIndex As Long
        laneIndex = FindAvailableLaneIndex(laneEndCols, lanes.Count, eventStartCol)

        Dim targetRow As Long
        If laneIndex = 0 Then
            targetRow = currentRow
            lanes.Add targetRow
            laneEndCols(CStr(lanes.Count)) = visualEndCol
            currentRow = currentRow + 1
            laneIndex = lanes.Count
            wsG.Cells(targetRow, 1).Value = curProj
            wsG.Cells(targetRow, 2).Value = curDest
            wsG.Cells(targetRow, 3).Value = curCat
            If laneIndex > 1 Then
                wsG.Cells(targetRow, 1).Font.Color = RGB(180, 180, 180)
                wsG.Cells(targetRow, 2).Font.Color = RGB(180, 180, 180)
                wsG.Cells(targetRow, 3).Font.Color = RGB(180, 180, 180)
            End If
        Else
            targetRow = CLng(lanes(laneIndex))
            laneEndCols(CStr(laneIndex)) = visualEndCol
        End If

        AppendCellText wsG.Cells(targetRow, 4), CStr(wsN.Cells(r, 6).Value)
        If Len(Trim(CStr(wsN.Cells(r, 7).Value))) = 0 Then
            AppendCellText wsG.Cells(targetRow, 5), yr & "/" & mo
        Else
            AppendCellText wsG.Cells(targetRow, 5), yr & "/" & mo & "/" & wsN.Cells(r, 7).Value
        End If

        Dim catColor As Variant
        catColor = GetCategoryColor(catColors, curCat)

        Dim fillColor As Long
        If Not IsEmpty(catColor) Then
            fillColor = CLng(catColor)
        ElseIf wsN.Cells(r, 5).Value = "MONTH" Then
            fillColor = COLOR_MONTH
        Else
            fillColor = COLOR_DATE
        End If

        If wsN.Cells(r, 5).Value = "MONTH" Then
            wsG.Cells(targetRow, eventStartCol).Interior.Color = fillColor
            wsG.Cells(targetRow, eventStartCol + 1).Interior.Color = fillColor
            wsG.Cells(targetRow, eventStartCol + 2).Interior.Color = fillColor
            wsG.Cells(targetRow, eventStartCol).Value = wsN.Cells(r, 4).Value
            wsG.Cells(targetRow, eventStartCol).WrapText = False
            wsG.Cells(targetRow, eventStartCol).HorizontalAlignment = xlLeft
        Else
            wsG.Cells(targetRow, eventStartCol).Interior.Color = fillColor
            wsG.Cells(targetRow, eventStartCol).Value = wsN.Cells(r, 4).Value
            wsG.Cells(targetRow, eventStartCol).WrapText = False
            wsG.Cells(targetRow, eventStartCol).HorizontalAlignment = xlLeft
        End If
NextR:
    Next

    Dim lastDataRow As Long
    lastDataRow = currentRow - 1
    If lastDataRow >= 2 Then
        wsG.Range(wsG.Cells(2, 1), wsG.Cells(lastDataRow, startCol - 1)).AutoFilter
    End If
End Sub

Private Function FindAvailableLaneIndex(ByVal laneEndCols As Object, ByVal laneCount As Long, ByVal eventStartCol As Long) As Long
    Dim i As Long
    For i = 1 To laneCount
        If laneEndCols.Exists(CStr(i)) Then
            If CLng(laneEndCols(CStr(i))) < eventStartCol Then
                FindAvailableLaneIndex = i
                Exit Function
            End If
        End If
    Next
    FindAvailableLaneIndex = 0
End Function

Private Function GetVisualEndCol(ByVal eventStartCol As Long, ByVal eventEndCol As Long, ByVal textValue As String, ByVal colWidth As Double) As Long
    Dim effectiveWidth As Double
    effectiveWidth = colWidth
    If effectiveWidth <= 0 Then effectiveWidth = 3

    Dim textLen As Long
    textLen = Len(textValue)
    If textLen <= 0 Then
        GetVisualEndCol = eventEndCol
        Exit Function
    End If

    Dim textCols As Long
    textCols = CLng(Int((textLen - 1) / effectiveWidth)) + 1

    Dim textEndCol As Long
    textEndCol = eventStartCol + textCols - 1

    If textEndCol > eventEndCol Then
        GetVisualEndCol = textEndCol
    Else
        GetVisualEndCol = eventEndCol
    End If
End Function

Private Sub AppendCellText(ByVal targetCell As Range, ByVal addText As String)
    If Len(addText) = 0 Then Exit Sub
    If Len(CStr(targetCell.Value)) = 0 Then
        targetCell.Value = addText
    Else
        targetCell.Value = CStr(targetCell.Value) & " / " & addText
    End If
End Sub

Option Explicit

'========================
' Settings
'========================
Private Const SHEET_INPUT As String = "Input"
Private Const SHEET_MASTER As String = "Master"
Private Const SHEET_GANTT As String = "Gantt"
Private Const SHEET_SETTINGS As String = "Settings"
Private Const SHEET_LOG As String = "Log"

Private Const SETTING_KEY_ACTUAL_STYLE As String = "ActualStyle"
Private Const ACTUAL_STYLE_SQUARE As String = "SQUARE"
Private Const ACTUAL_STYLE_BORDER As String = "BORDER"

' Hierarchy depth
Private Const MAX_LEVEL As Long = 4   ' If you change to 5, add L5 column in Input sheet.

' Input columns (legacy fixed constants; actual read uses header mapping)
Private Const COL_L1 As Long = 1  'A
Private Const COL_L2 As Long = 2  'B
Private Const COL_L3 As Long = 3  'C
Private Const COL_L4 As Long = 4  'D
Private Const COL_PLAN_START As Long = 5  'E
Private Const COL_PLAN_END As Long = 6    'F
Private Const COL_ACT_START As Long = 7   'G
Private Const COL_ACT_END As Long = 8     'H
Private Const COL_PROG As Long = 9        'I
Private Const COL_OWNER As Long = 10      'J
Private Const COL_STATUS As Long = 11     'K

' Master columns
Private Enum MasterCol
    mTaskID = 1
    mParentID = 2
    mLevel = 3
    mProject = 4
    mPath = 5
    mName = 6
    mPlanStart = 7
    mPlanEnd = 8
    mActStart = 9
    mActEnd = 10
    mProg = 11
    mOwner = 12
    mStatus = 13
    mIsLeaf = 14
End Enum

'========================
' Entry point
'========================
Public Sub Build_All()
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    
    EnsureSheets
    
    Dim nodes As Object          ' path -> node(dict)
    Dim children As Object       ' parentPath -> collection of childPath
    Dim nextId As Long
    
    Set nodes = CreateObject("Scripting.Dictionary")
    Set children = CreateObject("Scripting.Dictionary")
    nextId = 1
    
    BuildMasterFromInput nodes, children, nextId
    SyncLogOrderWithInput
    AggregateParentDates nodes, children
    WriteMasterSheet nodes
    BuildGanttSheet nodes, children
    ExportJson nodes, children
    
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
End Sub

'========================
' Sheet setup
'========================
Private Sub EnsureSheets()
    Dim wb As Workbook: Set wb = ThisWorkbook
    EnsureSheet wb, SHEET_INPUT
    EnsureSheet wb, SHEET_MASTER
    EnsureSheet wb, SHEET_GANTT
    EnsureSheet wb, SHEET_SETTINGS
    EnsureSheet wb, SHEET_LOG
    EnsureSettingsSheet
End Sub

Private Sub EnsureSheet(ByVal wb As Workbook, ByVal name As String)
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = wb.Worksheets(name)
    On Error GoTo 0
    If ws Is Nothing Then
        Set ws = wb.Worksheets.Add(After:=wb.Worksheets(wb.Worksheets.Count))
        ws.Name = name
    End If
End Sub

'========================
' Input -> Master
'========================
Private Sub BuildMasterFromInput(ByVal nodes As Object, ByVal children As Object, ByRef nextId As Long)
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets(SHEET_INPUT)
    Dim colMap As Object
    Set colMap = ResolveInputColumns(ws)
    
    Dim lastRow As Long
    lastRow = GetInputLastRow(ws, colMap)
    
    Dim r As Long
    For r = 2 To lastRow
        ' Skip completely empty row
        If IsRowEmpty(ws, r, colMap) Then GoTo ContinueRow
        
        ' Hierarchy values
        Dim lv(1 To 10) As String
        lv(1) = Trim(CStr(ws.Cells(r, CLng(colMap("L1"))).Value))
        lv(2) = Trim(CStr(ws.Cells(r, CLng(colMap("L2"))).Value))
        lv(3) = Trim(CStr(ws.Cells(r, CLng(colMap("L3"))).Value))
        lv(4) = Trim(CStr(ws.Cells(r, CLng(colMap("L4"))).Value))
        
        Dim i As Long
        For i = 1 To MAX_LEVEL
            If lv(i) = "" Then
                Err.Raise vbObjectError + 100, , "Missing hierarchy value at row " & r & ". L1-L" & MAX_LEVEL & " are required."
            End If
        Next i
        
        Dim pj As String: pj = lv(1)
        
        ' Dates (Plan/Actual are optional)
        Dim ps As Variant, pe As Variant
        ps = ws.Cells(r, CLng(colMap("PlanStart"))).Value
        pe = ws.Cells(r, CLng(colMap("PlanEnd"))).Value
        Dim hasPlanStart As Boolean: hasPlanStart = IsDate(ps)
        Dim hasPlanEnd As Boolean: hasPlanEnd = IsDate(pe)
        If hasPlanStart And hasPlanEnd Then
            If CDate(ps) > CDate(pe) Then
                Err.Raise vbObjectError + 102, , "PlanStart > PlanEnd at row " & r
            End If
        End If
        
        Dim asv As Variant, aev As Variant
        asv = ws.Cells(r, CLng(colMap("ActualStart"))).Value
        aev = ws.Cells(r, CLng(colMap("ActualEnd"))).Value
        
        Dim hasActStart As Boolean: hasActStart = IsDate(asv)
        Dim hasActEnd As Boolean: hasActEnd = IsDate(aev)
        If hasActStart And hasActEnd Then
            If CDate(asv) > CDate(aev) Then
                Err.Raise vbObjectError + 103, , "ActualStart > ActualEnd at row " & r
            End If
        End If
        
        Dim prog As Variant, owner As String, status As String
        prog = ws.Cells(r, CLng(colMap("Progress"))).Value
        owner = Trim(CStr(ws.Cells(r, CLng(colMap("Owner"))).Value))
        status = Trim(CStr(ws.Cells(r, CLng(colMap("Status"))).Value))
        
        ' Build path (L1/L2/... with "/")
        Dim path(1 To 10) As String
        path(1) = lv(1)
        For i = 2 To MAX_LEVEL
            path(i) = path(i - 1) & "/" & lv(i)
        Next i
        
        ' Create nodes (Lv1..LvMAX_LEVEL)
        EnsureNode nodes, children, path(1), vbNullString, 1, pj, lv(1), False, nextId
        For i = 2 To MAX_LEVEL
            EnsureNode nodes, children, path(i), path(i - 1), i, pj, lv(i), (i = MAX_LEVEL), nextId
        Next i
        
        ' Leaf attributes
        Dim leafPath As String: leafPath = path(MAX_LEVEL)
        Dim n As Object: Set n = nodes(leafPath)
        If hasPlanStart Then
            n("PlanStart") = CDate(ps)
            n("PlanEnd") = CDate(pe)
        Else
            n("PlanStart") = Empty
            n("PlanEnd") = Empty
        End If
        
        If hasActStart Then n("ActStart") = CDate(asv) Else n("ActStart") = Empty
        If hasActEnd Then n("ActEnd") = CDate(aev) Else n("ActEnd") = Empty
        
        n("Progress") = NormalizeProgress(prog)
        n("Owner") = owner
        n("Status") = status
        
ContinueRow:
    Next r
End Sub

Private Function IsRowEmpty(ByVal ws As Worksheet, ByVal r As Long, ByVal colMap As Object) As Boolean
    Dim k As Variant
    For Each k In colMap.Keys
        If Trim(CStr(ws.Cells(r, CLng(colMap(k))).Value)) <> "" Then
            IsRowEmpty = False
            Exit Function
        End If
    Next k
    IsRowEmpty = True
End Function

Private Function ResolveInputColumns(ByVal ws As Worksheet) As Object
    Dim headerIndex As Object
    Set headerIndex = BuildHeaderIndex(ws)
    
    Dim m As Object
    Set m = CreateObject("Scripting.Dictionary")
    
    Dim i As Long
    For i = 1 To MAX_LEVEL
        m.Add "L" & CStr(i), RequireHeaderColumn(headerIndex, Array("L" & CStr(i), "Level" & CStr(i), "Hierarchy" & CStr(i)), "L" & CStr(i))
    Next i
    
    m.Add "PlanStart", RequireHeaderColumn(headerIndex, Array("PlanStart", "Plan Start"), "PlanStart")
    m.Add "PlanEnd", RequireHeaderColumn(headerIndex, Array("PlanEnd", "Plan End"), "PlanEnd")
    m.Add "ActualStart", RequireHeaderColumn(headerIndex, Array("ActualStart", "Actual Start"), "ActualStart")
    m.Add "ActualEnd", RequireHeaderColumn(headerIndex, Array("ActualEnd", "Actual End"), "ActualEnd")
    m.Add "Progress", RequireHeaderColumn(headerIndex, Array("Progress"), "Progress")
    m.Add "Owner", RequireHeaderColumn(headerIndex, Array("Owner"), "Owner")
    m.Add "Status", RequireHeaderColumn(headerIndex, Array("Status"), "Status")
    
    Dim taskIdCol As Long
    taskIdCol = FindHeaderColumn(headerIndex, Array("TaskID", "Task Id", "ID"))
    If taskIdCol > 0 Then m.Add "TaskID", taskIdCol
    
    Set ResolveInputColumns = m
End Function

Private Function BuildHeaderIndex(ByVal ws As Worksheet) As Object
    Dim idx As Object
    Set idx = CreateObject("Scripting.Dictionary")
    
    Dim lastCol As Long
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    
    Dim c As Long
    For c = 1 To lastCol
        Dim raw As String
        raw = CStr(ws.Cells(1, c).Value)
        If Trim$(raw) <> "" Then
            Dim key As String
            key = NormalizeHeader(raw)
            If Not idx.Exists(key) Then idx.Add key, c
        End If
    Next c
    
    Set BuildHeaderIndex = idx
End Function

Private Function RequireHeaderColumn(ByVal headerIndex As Object, ByVal aliases As Variant, ByVal requiredName As String) As Long
    Dim i As Long
    For i = LBound(aliases) To UBound(aliases)
        Dim k As String
        k = NormalizeHeader(CStr(aliases(i)))
        If headerIndex.Exists(k) Then
            RequireHeaderColumn = CLng(headerIndex(k))
            Exit Function
        End If
    Next i
    
    Err.Raise vbObjectError + 110, , "Header '" & requiredName & "' was not found in Input row 1."
End Function

Private Function FindHeaderColumn(ByVal headerIndex As Object, ByVal aliases As Variant) As Long
    Dim i As Long
    For i = LBound(aliases) To UBound(aliases)
        Dim k As String
        k = NormalizeHeader(CStr(aliases(i)))
        If headerIndex.Exists(k) Then
            FindHeaderColumn = CLng(headerIndex(k))
            Exit Function
        End If
    Next i
    FindHeaderColumn = 0
End Function

Private Function NormalizeHeader(ByVal s As String) As String
    s = LCase$(Trim$(s))
    s = Replace(s, " ", "")
    s = Replace(s, ChrW(&H3000), "")
    s = Replace(s, "_", "")
    NormalizeHeader = s
End Function

Private Function GetInputLastRow(ByVal ws As Worksheet, ByVal colMap As Object) As Long
    Dim maxRow As Long
    maxRow = 1
    
    Dim k As Variant
    For Each k In colMap.Keys
        Dim c As Long
        c = CLng(colMap(k))
        Dim r As Long
        r = ws.Cells(ws.Rows.Count, c).End(xlUp).Row
        If r > maxRow Then maxRow = r
    Next k
    
    GetInputLastRow = maxRow
End Function

Private Sub SyncLogOrderWithInput()
    Dim wsInput As Worksheet: Set wsInput = ThisWorkbook.Worksheets(SHEET_INPUT)
    Dim colMap As Object
    Set colMap = ResolveInputColumns(wsInput)
    If Not colMap.Exists("TaskID") Then Exit Sub
    Dim taskIdOrder As Collection
    Set taskIdOrder = GetInputTaskIdOrder(wsInput, CLng(colMap("TaskID")), colMap)
    If taskIdOrder.Count = 0 Then Exit Sub
    Dim orderMap As Object
    Set orderMap = CreateObject("Scripting.Dictionary")
    Dim i As Long
    For i = 1 To taskIdOrder.Count
        orderMap(CStr(taskIdOrder(i))) = i
    Next i
    Dim wsLog As Worksheet: Set wsLog = ThisWorkbook.Worksheets(SHEET_LOG)
    Dim logTaskIdCol As Long
    logTaskIdCol = EnsureLogTaskIdColumn(wsLog)
    Dim lastCol As Long
    lastCol = GetSheetLastCol(wsLog)
    If lastCol < logTaskIdCol Then lastCol = logTaskIdCol
    Dim lastRow As Long
    lastRow = GetSheetLastRow(wsLog, lastCol)
    Dim logSeen As Object
    Set logSeen = CreateObject("Scripting.Dictionary")
    Dim r As Long
    For r = 2 To lastRow
        Dim key As String
        key = NormalizeTaskId(wsLog.Cells(r, logTaskIdCol).Value)
        If key <> "" Then
            If Not logSeen.Exists(key) Then logSeen.Add key, True
        End If
    Next r
    ' Add missing TaskID rows from Input (keep other columns as-is)
    For i = 1 To taskIdOrder.Count
        key = CStr(taskIdOrder(i))
        If Not logSeen.Exists(key) Then
            lastRow = lastRow + 1
            wsLog.Cells(lastRow, logTaskIdCol).Value = key
            logSeen.Add key, True
        End If
    Next i
    ' Sort helper column (row-wise sort; preserve all columns B+)
    Dim helperCol As Long
    helperCol = lastCol + 1
    wsLog.Cells(1, helperCol).Value = "__SortOrder"
    For r = 2 To lastRow
        key = NormalizeTaskId(wsLog.Cells(r, logTaskIdCol).Value)
        If key <> "" And orderMap.Exists(key) Then
            wsLog.Cells(r, helperCol).Value = CDbl(orderMap(key)) * 1000000# + CDbl(r)
        Else
            wsLog.Cells(r, helperCol).Value = 1000000000# + r
        End If
    Next r
    With wsLog.Sort
        .SortFields.Clear
        .SortFields.Add Key:=wsLog.Range(wsLog.Cells(2, helperCol), wsLog.Cells(lastRow, helperCol)), _
            SortOn:=xlSortOnValues, Order:=xlAscending, DataOption:=xlSortNormal
        .SetRange wsLog.Range(wsLog.Cells(1, 1), wsLog.Cells(lastRow, helperCol))
        .Header = xlYes
        .MatchCase = False
        .Orientation = xlTopToBottom
        .Apply
    End With
    wsLog.Columns(helperCol).Delete
End Sub

Private Function GetSheetLastCol(ByVal ws As Worksheet) As Long
    Dim lastCell As Range
    On Error Resume Next
    Set lastCell = ws.Cells.Find(What:="*", After:=ws.Cells(1, 1), LookIn:=xlFormulas, _
                                 LookAt:=xlPart, SearchOrder:=xlByColumns, _
                                 SearchDirection:=xlPrevious, MatchCase:=False)
    On Error GoTo 0
    
    If lastCell Is Nothing Then
        GetSheetLastCol = 1
    Else
        GetSheetLastCol = lastCell.Column
    End If
End Function

Private Function GetInputTaskIdOrder(ByVal ws As Worksheet, ByVal taskIdCol As Long, ByVal colMap As Object) As Collection
    Dim result As Collection
    Set result = New Collection
    
    Dim seen As Object
    Set seen = CreateObject("Scripting.Dictionary")
    
    Dim lastRow As Long
    lastRow = GetInputLastRow(ws, colMap)
    
    Dim r As Long
    For r = 2 To lastRow
        If Not IsRowEmpty(ws, r, colMap) Then
            Dim key As String
            key = NormalizeTaskId(ws.Cells(r, taskIdCol).Value)
            If key <> "" Then
                If Not seen.Exists(key) Then
                    seen.Add key, True
                    result.Add key
                End If
            End If
        End If
    Next r
    
    Set GetInputTaskIdOrder = result
End Function

Private Function EnsureLogTaskIdColumn(ByVal wsLog As Worksheet) As Long
    Dim headerIndex As Object
    Set headerIndex = BuildHeaderIndex(wsLog)
    
    Dim c As Long
    c = FindHeaderColumn(headerIndex, Array("TaskID", "Task Id", "ID"))
    If c > 0 Then
        EnsureLogTaskIdColumn = c
        Exit Function
    End If
    
    wsLog.Columns(1).Insert
    wsLog.Cells(1, 1).Value = "TaskID"
    EnsureLogTaskIdColumn = 1
End Function

Private Function GetSheetLastRow(ByVal ws As Worksheet, ByVal lastCol As Long) As Long
    Dim maxRow As Long
    maxRow = 1
    
    Dim c As Long
    For c = 1 To lastCol
        Dim r As Long
        r = ws.Cells(ws.Rows.Count, c).End(xlUp).Row
        If r > maxRow Then maxRow = r
    Next c
    
    GetSheetLastRow = maxRow
End Function

Private Function CreateEmptyRowValues(ByVal lastCol As Long) As Variant
    Dim arr() As Variant
    ReDim arr(1 To 1, 1 To lastCol)
    CreateEmptyRowValues = arr
End Function

Private Function NormalizeTaskId(ByVal v As Variant) As String
    NormalizeTaskId = Trim$(CStr(v))
End Function

Private Sub EnsureNode(ByVal nodes As Object, ByVal children As Object, ByVal path As String, ByVal parentPath As String, _
                       ByVal level As Long, ByVal project As String, ByVal name As String, ByVal isLeaf As Boolean, _
                       ByRef nextId As Long)
    If Not nodes.Exists(path) Then
        Dim n As Object: Set n = CreateObject("Scripting.Dictionary")
        n("TaskID") = nextId: nextId = nextId + 1
        n("ParentPath") = parentPath
        n("ParentID") = 0 ' Resolve later
        n("Level") = level
        n("Project") = project
        n("Path") = path
        n("Name") = name
        
        n("PlanStart") = Empty
        n("PlanEnd") = Empty
        n("ActStart") = Empty
        n("ActEnd") = Empty
        
        n("Progress") = Empty
        n("Owner") = ""
        n("Status") = ""
        n("IsLeaf") = isLeaf
        
        nodes.Add path, n
        
        If parentPath <> "" Then
            AddChild children, parentPath, path
        End If
    Else
        If isLeaf Then nodes(path)("IsLeaf") = True
    End If
End Sub

Private Sub AddChild(ByVal children As Object, ByVal parentPath As String, ByVal childPath As String)
    Dim col As Collection
    If Not children.Exists(parentPath) Then
        Set col = New Collection
        children.Add parentPath, col
    Else
        Set col = children(parentPath)
    End If
    col.Add childPath
End Sub

Private Function NormalizeProgress(ByVal v As Variant) As Variant
    If IsEmpty(v) Or v = "" Then
        NormalizeProgress = Empty
        Exit Function
    End If
    Dim d As Double
    d = CDbl(v)
    If d < 0 Then d = 0
    If d > 100 Then d = 100
    NormalizeProgress = d
End Function

'========================
' Aggregate parent Plan/Actual dates and resolve ParentID
'========================
Private Sub AggregateParentDates(ByVal nodes As Object, ByVal children As Object)
    Dim lvl As Long
    For lvl = MAX_LEVEL - 1 To 1 Step -1
        Dim k As Variant
        For Each k In nodes.Keys
            Dim n As Object: Set n = nodes(k)
            If CLng(n("Level")) = lvl Then
                If children.Exists(CStr(n("Path"))) Then
                    Dim c As Collection: Set c = children(CStr(n("Path")))
                    
                    Dim minPlanS As Variant, maxPlanE As Variant
                    Dim minActS As Variant, maxActE As Variant
                    minPlanS = Empty: maxPlanE = Empty
                    minActS = Empty: maxActE = Empty
                    
                    Dim i As Long
                    For i = 1 To c.Count
                        Dim ch As Object: Set ch = nodes(c(i))
                        
                        ' Aggregate Plan
                        If Not IsEmpty(ch("PlanStart")) Then
                            If IsEmpty(minPlanS) Then
                                minPlanS = ch("PlanStart")
                            ElseIf CDate(ch("PlanStart")) < CDate(minPlanS) Then
                                minPlanS = ch("PlanStart")
                            End If
                        End If
                        If Not IsEmpty(ch("PlanEnd")) Then
                            If IsEmpty(maxPlanE) Then
                                maxPlanE = ch("PlanEnd")
                            ElseIf CDate(ch("PlanEnd")) > CDate(maxPlanE) Then
                                maxPlanE = ch("PlanEnd")
                            End If
                        End If
                        
                        ' Aggregate Actual (only existing values)
                        If Not IsEmpty(ch("ActStart")) Then
                            If IsEmpty(minActS) Then
                                minActS = ch("ActStart")
                            ElseIf CDate(ch("ActStart")) < CDate(minActS) Then
                                minActS = ch("ActStart")
                            End If
                        End If
                        If Not IsEmpty(ch("ActEnd")) Then
                            If IsEmpty(maxActE) Then
                                maxActE = ch("ActEnd")
                            ElseIf CDate(ch("ActEnd")) > CDate(maxActE) Then
                                maxActE = ch("ActEnd")
                            End If
                        End If
                    Next i
                    
                    If Not IsEmpty(minPlanS) Then n("PlanStart") = CDate(minPlanS)
                    If Not IsEmpty(maxPlanE) Then n("PlanEnd") = CDate(maxPlanE)
                    If Not IsEmpty(minActS) Then n("ActStart") = CDate(minActS)
                    If Not IsEmpty(maxActE) Then n("ActEnd") = CDate(maxActE)
                End If
            End If
        Next k
    Next lvl
    
    ' Resolve ParentID
    Dim kk As Variant
    For Each kk In nodes.Keys
        Dim nn As Object: Set nn = nodes(kk)
        Dim pp As String: pp = CStr(nn("ParentPath"))
        If pp <> "" Then
            nn("ParentID") = CLng(nodes(pp)("TaskID"))
        Else
            nn("ParentID") = 0
        End If
    Next kk
End Sub

'========================
' Output Master sheet
'========================
Private Sub WriteMasterSheet(ByVal nodes As Object)
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets(SHEET_MASTER)
    ws.Cells.Clear
    
    ws.Cells(1, mTaskID).Value = "TaskID"
    ws.Cells(1, mParentID).Value = "ParentID"
    ws.Cells(1, mLevel).Value = "Level"
    ws.Cells(1, mProject).Value = "Project"
    ws.Cells(1, mPath).Value = "Path"
    ws.Cells(1, mName).Value = "Name"
    ws.Cells(1, mPlanStart).Value = "PlanStart"
    ws.Cells(1, mPlanEnd).Value = "PlanEnd"
    ws.Cells(1, mActStart).Value = "ActualStart"
    ws.Cells(1, mActEnd).Value = "ActualEnd"
    ws.Cells(1, mProg).Value = "Progress"
    ws.Cells(1, mOwner).Value = "Owner"
    ws.Cells(1, mStatus).Value = "Status"
    ws.Cells(1, mIsLeaf).Value = "IsLeaf"
    
    Dim arrKeys() As Variant
    arrKeys = nodes.Keys
    
    Dim i As Long, j As Long
    For i = LBound(arrKeys) To UBound(arrKeys) - 1
        For j = i + 1 To UBound(arrKeys)
            If CLng(nodes(arrKeys(j))("TaskID")) < CLng(nodes(arrKeys(i))("TaskID")) Then
                Dim tmp As Variant: tmp = arrKeys(i): arrKeys(i) = arrKeys(j): arrKeys(j) = tmp
            End If
        Next j
    Next i
    
    Dim r As Long: r = 2
    For i = LBound(arrKeys) To UBound(arrKeys)
        Dim n As Object: Set n = nodes(arrKeys(i))
        
        ws.Cells(r, mTaskID).Value = n("TaskID")
        ws.Cells(r, mParentID).Value = n("ParentID")
        ws.Cells(r, mLevel).Value = n("Level")
        ws.Cells(r, mProject).Value = n("Project")
        ws.Cells(r, mPath).Value = n("Path")
        ws.Cells(r, mName).Value = n("Name")
        
        If Not IsEmpty(n("PlanStart")) Then ws.Cells(r, mPlanStart).Value = n("PlanStart")
        If Not IsEmpty(n("PlanEnd")) Then ws.Cells(r, mPlanEnd).Value = n("PlanEnd")
        If Not IsEmpty(n("ActStart")) Then ws.Cells(r, mActStart).Value = n("ActStart")
        If Not IsEmpty(n("ActEnd")) Then ws.Cells(r, mActEnd).Value = n("ActEnd")
        
        If Not IsEmpty(n("Progress")) Then ws.Cells(r, mProg).Value = n("Progress")
        ws.Cells(r, mOwner).Value = n("Owner")
        ws.Cells(r, mStatus).Value = n("Status")
        ws.Cells(r, mIsLeaf).Value = IIf(n("IsLeaf"), 1, 0)
        
        r = r + 1
    Next i
    
    ws.Columns.AutoFit
End Sub

'========================
' Build Gantt (Plan + Actual overlay in same row)
'========================
Private Sub BuildGanttSheet(ByVal nodes As Object, ByVal children As Object)
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets(SHEET_GANTT)
    ws.Cells.UnMerge
    ws.Cells.Clear
    
    Dim actualStyle As String
    actualStyle = GetActualStyle()
    
    ' Determine axis date range (Plan + Actual)
    Dim minS As Variant, maxE As Variant
    minS = Empty: maxE = Empty
    
    Dim k As Variant
    For Each k In nodes.Keys
        Dim n As Object: Set n = nodes(k)
        UpdateMinMaxDate minS, maxE, n("PlanStart"), n("PlanEnd")
        UpdateMinMaxDate minS, maxE, n("ActStart"), n("ActEnd")
    Next k
    
    Dim startDate As Date, endDate As Date
    Dim hasAxis As Boolean
    hasAxis = (Not IsEmpty(minS) And Not IsEmpty(maxE))
    If hasAxis Then
        startDate = CDate(minS)
        endDate = CDate(maxE)
    End If
    
    Dim col0 As Long: col0 = MAX_LEVEL + 8
    If hasAxis Then
        Dim totalDays As Long
        totalDays = DateDiff("d", startDate, endDate) + 1
        Dim maxDays As Long
        maxDays = Columns.Count - col0 + 1
        If totalDays > maxDays Then
            ' Clip to max displayable columns
            endDate = DateAdd("d", maxDays - 1, startDate)
        End If
    End If
    
    ' Header rows
    Dim h As Long
    For h = 1 To MAX_LEVEL
        ws.Cells(3, h).Value = "L" & CStr(h)
    Next h
    ws.Cells(3, MAX_LEVEL + 1).Value = "PlanStart"
    ws.Cells(3, MAX_LEVEL + 2).Value = "PlanEnd"
    ws.Cells(3, MAX_LEVEL + 3).Value = "ActualStart"
    ws.Cells(3, MAX_LEVEL + 4).Value = "ActualEnd"
    ws.Cells(3, MAX_LEVEL + 5).Value = "Progress"
    ws.Cells(3, MAX_LEVEL + 6).Value = "Owner"
    ws.Cells(3, MAX_LEVEL + 7).Value = "Status"
    
    Dim lastDateCol As Long
    If hasAxis Then
        Dim d As Date
        Dim c As Long: c = col0
        For d = startDate To endDate
            ws.Cells(1, c).Value = Format$(d, "yyyy")
            ws.Cells(2, c).Value = Format$(d, "mm")
            ws.Cells(3, c).Value = Format$(d, "dd")
            c = c + 1
        Next d
        
        lastDateCol = col0 + DateDiff("d", startDate, endDate)
        MergeSameValueAcrossRow ws, 1, col0, lastDateCol ' YYYY
        MergeSameValueAcrossRow ws, 2, col0, lastDateCol ' MM
    Else
        lastDateCol = col0 - 1
    End If
    
    ' DFS order from Level=1 roots sorted by TaskID
    Dim roots As Collection: Set roots = New Collection
    For Each k In nodes.Keys
        If CLng(nodes(k)("Level")) = 1 Then roots.Add CStr(k)
    Next k
    SortPathsByTaskId nodes, roots
    
    Dim order As Collection: Set order = New Collection
    Dim i As Long
    For i = 1 To roots.Count
        DFSAppend nodes, children, roots(i), order
    Next i
    
    ' Bar style (same row overlay)
    ' - Plan: light fill
    ' - Actual: square/border
    Dim planColor As Long: planColor = RGB(200, 220, 240)
    Dim parentPlanColor As Long: parentPlanColor = RGB(235, 242, 250)
    
    Dim row As Long: row = 4
    Dim prevL1 As String
    prevL1 = ""
    For i = 1 To order.Count
        Dim p As String: p = order(i)
        Dim n2 As Object: Set n2 = nodes(p)
        If Not CBool(n2("IsLeaf")) Then GoTo ContinueGanttRow
        
        Dim seg() As String
        seg = Split(CStr(n2("Path")), "/")
        Dim currentL1 As String
        If UBound(seg) >= 0 Then
            currentL1 = CStr(seg(0))
        Else
            currentL1 = ""
        End If
        
        If prevL1 <> "" And currentL1 <> prevL1 Then
            row = row + 1 ' add one blank row when L1 changes
            With ws.Range(ws.Cells(row, 1), ws.Cells(row, lastDateCol)).Borders(xlEdgeTop)
                .LineStyle = xlContinuous
                .Weight = xlThick
            End With
        End If
        prevL1 = currentL1
        
        Dim sIdx As Long
        For sIdx = LBound(seg) To UBound(seg)
            If sIdx + 1 <= MAX_LEVEL Then
                ws.Cells(row, sIdx + 1).Value = seg(sIdx)
            End If
        Next sIdx
        
        If Not IsEmpty(n2("PlanStart")) Then ws.Cells(row, MAX_LEVEL + 1).Value = n2("PlanStart")
        If Not IsEmpty(n2("PlanEnd")) Then ws.Cells(row, MAX_LEVEL + 2).Value = n2("PlanEnd")
        If Not IsEmpty(n2("ActStart")) Then ws.Cells(row, MAX_LEVEL + 3).Value = n2("ActStart")
        If Not IsEmpty(n2("ActEnd")) Then ws.Cells(row, MAX_LEVEL + 4).Value = n2("ActEnd")
        If Not IsEmpty(n2("Progress")) Then ws.Cells(row, MAX_LEVEL + 5).Value = n2("Progress")
        ws.Cells(row, MAX_LEVEL + 6).Value = n2("Owner")
        ws.Cells(row, MAX_LEVEL + 7).Value = n2("Status")
        
        ' Plan bar
        If Not IsEmpty(n2("PlanStart")) And Not IsEmpty(n2("PlanEnd")) Then
            DrawBar ws, row, col0, startDate, CDate(n2("PlanStart")), CDate(n2("PlanEnd")), _
                    IIf(CBool(n2("IsLeaf")), planColor, parentPlanColor), False, xlPatternSolid
        End If
        
        ' Actual bar
        ' If ActualEnd is empty, show until today
        If Not IsEmpty(n2("ActStart")) Then
            Dim aStart As Date: aStart = CDate(n2("ActStart"))
            Dim aEnd As Date
            If Not IsEmpty(n2("ActEnd")) Then
                aEnd = CDate(n2("ActEnd"))
            Else
                aEnd = Date ' Today
            End If
            If aEnd < aStart Then aEnd = aStart
            
            If actualStyle = ACTUAL_STYLE_BORDER Then
                DrawActualBorders ws, row, col0, startDate, aStart, aEnd
            Else
                DrawActualSquares ws, row, col0, startDate, aStart, aEnd
            End If
        End If
        
        row = row + 1
ContinueGanttRow:
    Next i
    
    Dim lastTaskRow As Long
    lastTaskRow = row - 1
    If hasAxis Then
        ShadeWeekendColumns ws, col0, startDate, endDate, lastTaskRow
    End If
    
    ws.Rows(1).Font.Bold = True
    ws.Rows(2).Font.Bold = True
    ws.Rows(3).Font.Bold = True
    For h = 1 To MAX_LEVEL
        ws.Columns(h).ColumnWidth = 16
    Next h
    
    ws.Columns(MAX_LEVEL + 1).ColumnWidth = 11
    ws.Columns(MAX_LEVEL + 2).ColumnWidth = 11
    ws.Columns(MAX_LEVEL + 3).ColumnWidth = 11
    ws.Columns(MAX_LEVEL + 4).ColumnWidth = 11
    ws.Columns(MAX_LEVEL + 5).ColumnWidth = 10
    ws.Columns(MAX_LEVEL + 6).ColumnWidth = 12
    ws.Columns(MAX_LEVEL + 7).ColumnWidth = 12
    
    If hasAxis Then
        ws.Range(ws.Cells(1, col0), ws.Cells(1, col0 + DateDiff("d", startDate, endDate))).ColumnWidth = 3
    End If
    ws.Columns.AutoFit
    ' Avoid Select to prevent active-sheet dependent 1004 errors
End Sub

Private Sub EnsureSettingsSheet()
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets(SHEET_SETTINGS)
    If Trim$(CStr(ws.Cells(1, 1).Value)) = "" Then ws.Cells(1, 1).Value = "Key"
    If Trim$(CStr(ws.Cells(1, 2).Value)) = "" Then ws.Cells(1, 2).Value = "Value"
    
    If Trim$(CStr(ws.Cells(2, 1).Value)) = "" Then ws.Cells(2, 1).Value = SETTING_KEY_ACTUAL_STYLE
    If Trim$(CStr(ws.Cells(2, 2).Value)) = "" Then ws.Cells(2, 2).Value = ACTUAL_STYLE_SQUARE
    
    ws.Cells(1, 4).Value = "ActualStyle options:"
    ws.Cells(2, 4).Value = ACTUAL_STYLE_SQUARE
    ws.Cells(3, 4).Value = ACTUAL_STYLE_BORDER
End Sub

Private Function GetActualStyle() As String
    Dim ws As Worksheet: Set ws = ThisWorkbook.Worksheets(SHEET_SETTINGS)
    Dim lastRow As Long: lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    
    Dim r As Long
    For r = 2 To lastRow
        If UCase$(Trim$(CStr(ws.Cells(r, 1).Value))) = UCase$(SETTING_KEY_ACTUAL_STYLE) Then
            Dim v As String
            v = UCase$(Trim$(CStr(ws.Cells(r, 2).Value)))
            If v = ACTUAL_STYLE_BORDER Then
                GetActualStyle = ACTUAL_STYLE_BORDER
            Else
                GetActualStyle = ACTUAL_STYLE_SQUARE
            End If
            Exit Function
        End If
    Next r
    
    GetActualStyle = ACTUAL_STYLE_SQUARE
End Function

Private Sub DrawActualSquares(ByVal ws As Worksheet, ByVal row As Long, ByVal col0 As Long, ByVal axisStart As Date, _
                              ByVal s As Date, ByVal e As Date)
    Dim sCol As Long, eCol As Long
    sCol = col0 + DateDiff("d", axisStart, s)
    eCol = col0 + DateDiff("d", axisStart, e)
    If eCol < sCol Then eCol = sCol
    
    Dim cc As Long
    For cc = sCol To eCol
        With ws.Cells(row, cc)
            .Value = "□"
            .HorizontalAlignment = xlCenter
            .VerticalAlignment = xlCenter
        End With
    Next cc
End Sub

Private Sub DrawActualBorders(ByVal ws As Worksheet, ByVal row As Long, ByVal col0 As Long, ByVal axisStart As Date, _
                              ByVal s As Date, ByVal e As Date)
    Dim sCol As Long, eCol As Long
    sCol = col0 + DateDiff("d", axisStart, s)
    eCol = col0 + DateDiff("d", axisStart, e)
    If eCol < sCol Then eCol = sCol
    
    Dim rg As Range
    Set rg = ws.Range(ws.Cells(row, sCol), ws.Cells(row, eCol))
    
    rg.Value = ""
    
    ' Draw one outer border from start to end
    With rg.Borders(xlEdgeLeft)
        .LineStyle = xlContinuous
        .Weight = xlThin
    End With
    With rg.Borders(xlEdgeTop)
        .LineStyle = xlContinuous
        .Weight = xlThin
    End With
    With rg.Borders(xlEdgeBottom)
        .LineStyle = xlContinuous
        .Weight = xlThin
    End With
    With rg.Borders(xlEdgeRight)
        .LineStyle = xlContinuous
        .Weight = xlThin
    End With
    rg.Borders(xlInsideVertical).LineStyle = xlLineStyleNone
    rg.Borders(xlInsideHorizontal).LineStyle = xlLineStyleNone
End Sub

Private Sub ShadeWeekendColumns(ByVal ws As Worksheet, ByVal col0 As Long, ByVal startDate As Date, ByVal endDate As Date, ByVal lastRow As Long)
    If lastRow < 4 Then Exit Sub
    
    Dim d As Date
    Dim c As Long
    Dim weekendColor As Long
    weekendColor = RGB(230, 230, 230)
    
    For d = startDate To endDate
        c = col0 + DateDiff("d", startDate, d)
        If Weekday(d, vbMonday) >= 6 Then
            With ws.Range(ws.Cells(4, c), ws.Cells(lastRow, c)).Interior
                .Pattern = xlPatternSolid
                .Color = weekendColor
            End With
        End If
    Next d
End Sub

Private Sub MergeSameValueAcrossRow(ByVal ws As Worksheet, ByVal rowNum As Long, ByVal colStart As Long, ByVal colEnd As Long)
    If colEnd < colStart Then Exit Sub
    
    Dim prevDisplayAlerts As Boolean
    prevDisplayAlerts = Application.DisplayAlerts
    Application.DisplayAlerts = False
    On Error GoTo SafeExit
    
    Dim runStart As Long
    runStart = colStart
    
    Dim c As Long
    For c = colStart + 1 To colEnd + 1
        Dim isBreak As Boolean
        If c > colEnd Then
            isBreak = True
        Else
            isBreak = (CStr(ws.Cells(rowNum, c).Value) <> CStr(ws.Cells(rowNum, runStart).Value))
        End If
        
        If isBreak Then
            If c - 1 > runStart Then
                With ws.Range(ws.Cells(rowNum, runStart), ws.Cells(rowNum, c - 1))
                    .Merge
                    .HorizontalAlignment = xlCenter
                    .VerticalAlignment = xlCenter
                End With
            End If
            runStart = c
        End If
    Next c
    
SafeExit:
    Application.DisplayAlerts = prevDisplayAlerts
End Sub

Private Sub UpdateMinMaxDate(ByRef minS As Variant, ByRef maxE As Variant, ByVal s As Variant, ByVal e As Variant)
    If Not IsEmpty(s) And IsDate(s) Then
        If IsEmpty(minS) Then
            minS = CDate(s)
        ElseIf CDate(s) < CDate(minS) Then
            minS = CDate(s)
        End If
    End If
    If Not IsEmpty(e) And IsDate(e) Then
        If IsEmpty(maxE) Then
            maxE = CDate(e)
        ElseIf CDate(e) > CDate(maxE) Then
            maxE = CDate(e)
        End If
    End If
End Sub

Private Sub DrawBar(ByVal ws As Worksheet, ByVal row As Long, ByVal col0 As Long, ByVal axisStart As Date, _
                    ByVal s As Date, ByVal e As Date, ByVal color As Long, ByVal usePattern As Boolean, ByVal pat As XlPattern)
    Dim sCol As Long, eCol As Long
    sCol = col0 + DateDiff("d", axisStart, s)
    eCol = col0 + DateDiff("d", axisStart, e)
    If eCol < sCol Then eCol = sCol
    
    Dim cc As Long
    For cc = sCol To eCol
        With ws.Cells(row, cc).Interior
            .Color = color
            If usePattern Then
                .Pattern = pat
            Else
                .Pattern = xlPatternSolid
            End If
        End With
    Next cc
End Sub

Private Sub DFSAppend(ByVal nodes As Object, ByVal children As Object, ByVal path As String, ByVal order As Collection)
    order.Add path
    If children.Exists(path) Then
        Dim col As Collection: Set col = children(path)
        SortPathsByTaskId nodes, col
        Dim i As Long
        For i = 1 To col.Count
            DFSAppend nodes, children, col(i), order
        Next i
    End If
End Sub

Private Sub SortPathsByTaskId(ByVal nodes As Object, ByVal col As Collection)
    Dim n As Long: n = col.Count
    If n <= 1 Then Exit Sub
    
    Dim arr() As String
    ReDim arr(1 To n)
    Dim i As Long
    For i = 1 To n
        arr(i) = col(i)
    Next i
    
    Dim j As Long
    For i = 1 To n - 1
        For j = i + 1 To n
            If CLng(nodes(arr(j))("TaskID")) < CLng(nodes(arr(i))("TaskID")) Then
                Dim t As String: t = arr(i): arr(i) = arr(j): arr(j) = t
            End If
        Next j
    Next i
    
    Do While col.Count > 0
        col.Remove 1
    Loop
    For i = 1 To n
        col.Add arr(i)
    Next i
End Sub

'========================
' JSON export (Plan/Actual)
'========================
Private Sub ExportJson(ByVal nodes As Object, ByVal children As Object)
    Dim projects As Object: Set projects = CreateObject("Scripting.Dictionary")
    Dim k As Variant
    For Each k In nodes.Keys
        Dim n As Object: Set n = nodes(k)
        If CLng(n("Level")) = 1 Then
            Dim pj As String: pj = CStr(n("Project"))
            If Not projects.Exists(pj) Then projects.Add pj, New Collection
            projects(pj).Add CStr(n("Path"))
        End If
    Next k
    
    Dim json As String
    json = "{""projects"":["
    
    Dim firstP As Boolean: firstP = True
    Dim pjKey As Variant
    For Each pjKey In projects.Keys
        If Not firstP Then json = json & ","
        firstP = False
        
        json = json & "{"
        json = json & """name"":""" & EscapeJson(CStr(pjKey)) & ""","
        json = json & """roots"":["
        
        Dim roots As Collection: Set roots = projects(pjKey)
        SortPathsByTaskId nodes, roots
        
        Dim i As Long, firstR As Boolean: firstR = True
        For i = 1 To roots.Count
            If Not firstR Then json = json & ","
            firstR = False
            json = json & NodeToJson(nodes, children, roots(i))
        Next i
        
        json = json & "]}"
    Next pjKey
    
    json = json & "]}"

    If ThisWorkbook.Path = "" Then
        Err.Raise vbObjectError + 300, , "JSON output path is not available. Save this workbook first."
    End If
    
    Dim outPath As String
    outPath = ThisWorkbook.Path & "\tasks_backup.json"
    WriteTextFile outPath, json
End Sub

Private Function NodeToJson(ByVal nodes As Object, ByVal children As Object, ByVal path As String) As String
    Dim n As Object: Set n = nodes(path)
    
    Dim s As String
    s = "{"
    s = s & """id"":" & CLng(n("TaskID")) & ","
    s = s & """parentId"":" & CLng(n("ParentID")) & ","
    s = s & """level"":" & CLng(n("Level")) & ","
    s = s & """project"":""" & EscapeJson(CStr(n("Project"))) & ""","
    s = s & """name"":""" & EscapeJson(CStr(n("Name"))) & ""","
    s = s & """path"":""" & EscapeJson(CStr(n("Path"))) & ""","
    s = s & """isLeaf"":" & LCase$(CStr(CBool(n("IsLeaf")))) & ","
    
    s = s & """planStart"":" & JsonDateOrNull(n("PlanStart")) & ","
    s = s & """planEnd"":" & JsonDateOrNull(n("PlanEnd")) & ","
    s = s & """actualStart"":" & JsonDateOrNull(n("ActStart")) & ","
    s = s & """actualEnd"":" & JsonDateOrNull(n("ActEnd")) & ","
    
    If Not IsEmpty(n("Progress")) Then
        s = s & """progress"":" & CDbl(n("Progress")) & ","
    Else
        s = s & """progress"":null,"
    End If
    
    s = s & """owner"":""" & EscapeJson(CStr(n("Owner"))) & ""","
    s = s & """status"":""" & EscapeJson(CStr(n("Status"))) & """"
    
    If children.Exists(path) Then
        Dim col As Collection: Set col = children(path)
        SortPathsByTaskId nodes, col
        
        s = s & ",""children"":["
        Dim i As Long, first As Boolean: first = True
        For i = 1 To col.Count
            If Not first Then s = s & ","
            first = False
            s = s & NodeToJson(nodes, children, col(i))
        Next i
        s = s & "]"
    End If
    
    s = s & "}"
    NodeToJson = s
End Function

Private Function JsonDateOrNull(ByVal v As Variant) As String
    If Not IsEmpty(v) And IsDate(v) Then
        JsonDateOrNull = """" & Format$(CDate(v), "yyyy-mm-dd") & """"
    Else
        JsonDateOrNull = "null"
    End If
End Function

Private Function EscapeJson(ByVal s As String) As String
    s = Replace(s, "\", "\\")
    s = Replace(s, """", "\""")
    s = Replace(s, vbCrLf, "\n")
    s = Replace(s, vbCr, "\n")
    s = Replace(s, vbLf, "\n")
    EscapeJson = s
End Function

Private Sub WriteTextFile(ByVal path As String, ByVal text As String)
    Dim fso As Object: Set fso = CreateObject("Scripting.FileSystemObject")
    Dim ts As Object: Set ts = fso.CreateTextFile(path, True, True) ' overwrite, unicode
    ts.Write text
    ts.Close
End Sub

